import Route from '@ember/routing/route';
import { RouteQueryManager } from 'ember-apollo-client';

import query from '@base-cms/manage/gql/queries/content/index';

export default Route.extend(RouteQueryManager, {
  /**
   *
   * @param {object} params
   */
  model() {
    const input = {
      sort: { field: 'updated', order: 'desc' },
      pagination: { limit: 24 },
    };
    const variables = { input };
    return this.get('apollo').watchQuery({ query, variables, fetchPolicy: 'network-only' }, 'allContent');
  },
});
