// @flow
import React from 'react';
import {shallowEqual} from './utils';

type DataTransformer = (props: Object, data: Object) => Object;

export type GraphQLSubscription = {
  query: string,
  variables: (props: Object) => Object,
  transform?: DataTransformer
};

type QueryDeclaration = {|query: string, transform?: (props: Object, response: Object) => Object|}

type QueryDeclarations = {
  [id: string]: string | QueryDeclaration
};

export type GraphQLContainerOptions = {
  query?: string,
  variables?: (props: Object) => Object,
  mutations?: QueryDeclarations,
  queries?: QueryDeclarations,
  subscriptions?: {[id: string]: GraphQLSubscription},
};

export default (Container: any, options: GraphQLContainerOptions = {}) => {
  return class GraphQLContainer extends React.Component {

    static contextTypes = {
      graphQL: React.PropTypes.shape({
        client: React.PropTypes.shape({
          query: React.PropTypes.func.isRequired,
          subscribe: React.PropTypes.func,
          unsubscribe: React.PropTypes.func
        })
      }).isRequired
    };

    state = {
      loading: false,
      loaded: false,
      error: undefined
    };

    subscriptions = {};

    componentDidMount() {
      if (options.query) {
        this.runQueryAndSetState(options.query, this.buildVariables(options.variables, this.props));
      }

      if (options.subscriptions) {
        this.buildSubscriptions(options.subscriptions, null, this.props);
      }
    }

    componentWillReceiveProps(nextProps: Object) {
      if (options.query && this.hasVariablesChanged(options.variables, this.props, nextProps)) {
        this.runQueryAndSetState(options.query, this.buildVariables(options.variables, nextProps));
      }

      if (options.subscriptions) {
        this.buildSubscriptions(options.subscriptions, this.props, nextProps);
      }
    }

    componentWillUnmount() {
      Object.keys(this.subscriptions).forEach(key => this.unsubscribe(this.subscriptions[key]));
    }

    buildSubscriptions(subscriptions: {[key: string]: GraphQLSubscription}, prevProps: ?Object = {}, nextProps: Object) {
      Object.keys(subscriptions).forEach(key => {
        const subscription = subscriptions[key];

        if (prevProps && !this.hasVariablesChanged(subscription.variables, prevProps, nextProps)) {
          return;
        }

        // Unsubscribe from previous subscription
        if (this.subscriptions[key]) {
          this.unsubscribe(this.subscriptions[key]);
        }

        this.subscriptions[key] = this.subscribeWithProps(key, subscription, nextProps);
      });
    }

    subscribeWithProps(key: string, subscription: GraphQLSubscription, nextProps: Object) {
      if (!this.context.graphQL.client.subscribe) {
        return;
      }

      const variables = this.buildVariables(subscription.variables, nextProps);
      return this.context.graphQL.client.subscribe(subscription.query, variables, (err, data) => {
        if (subscription.transform) {
          data = subscription.transform.call(null, {...this.props, data: this.state}, data);
        }

        this.setState({[key]: data});
      });
    }

    unsubscribe(id: any) {
      if (!this.context.graphQL.client.unsubscribe) {
        return;
      }

      this.context.graphQL.client.unsubscribe(id);
    }

    buildQueries(queries: ?QueryDeclarations) {
      if (queries) {
        return(Object.keys(queries) || []).reduce((memo, name) => {
          if (queries && queries[name]) {
            const query = this.getQuery(queries[name]);
            memo[name] = (variables) => this.runQueries(query, variables);
          }
          return memo;
        }, {});
      } else {
        return {};
      }
    }

    getQuery(query: string | QueryDeclaration): QueryDeclaration {
      if (typeof(query) === 'string') {
        return {query};
      } else {
        return query;
      }
    }

    runQueries(queryDeclaration: QueryDeclaration, variables: Object) {
      const {query, transform} = queryDeclaration;

      return this.runQuery(query, variables).then(this.handleResponse).then(response => {
        return this.transformResponse(response, transform);
      });
    }

    handleResponse(response: Object) {
      return {
        ...response.data,
        ...(response.errors ? {errors: response.errors} : {})
      };
    }

    transformResponse(response: Object, transform?: (props: Object, response: Object) => Object) {
      if (transform) {
        const data = transform.call(null, {...this.props, data: this.state}, response);
        this.setState(data);
      }
      return response;
    }

    buildVariables(variableBuilder: ?Function, props: Object) {
      return variableBuilder && variableBuilder.call(null, props);
    }

    hasVariablesChanged(variableBuilder: ?Function, prevProps: Object, nextProps: Object) {
      const prevVars = this.buildVariables(variableBuilder, prevProps);
      const nextVars = this.buildVariables(variableBuilder, nextProps);

      return !shallowEqual(prevVars || {}, nextVars || {});
    }

    runQueryAndSetState(query: ?string, variables: ?Object = {}) {
      if (!query) {
        return;
      }

      this.setState({loading: true});
      this.runQuery(query, variables).then(response => {
        this.setState({loading: false, loaded: true, ...response.data});
      }, error => {
        // TODO: Need to cancel promise here since this may be triggered in unmounted component
        this.setState({loading: false, loaded: false, error: error});
      });
    }

    runQuery(query: ?string, variables: ?Object) {
      return this.context.graphQL.client.query(query, variables);
    }

    render() {
      return (
        <Container
          {...this.props}
          {...this.buildQueries(options.mutations)}
          {...this.buildQueries(options.queries)}
          data={this.state}
          />
      );
    }
  };
};
