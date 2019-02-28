const createError = require('http-errors');
const gql = require('graphql-tag');
const { extractFragmentData } = require('../utils');
const defaultFragment = require('../gql/fragments/with-website-section');

/**
 * Builds the `websiteSectionAlias` and `websiteSectionRedirect` GraphQL query.
 *
 * @param {object} params
 * @param {string} [params.queryFragment] The `graphql-tag` fragment
 *                                        to apply to the `contentPage` query.
 */
const buildQuery = ({ queryFragment } = {}) => {
  const { spreadFragmentName, processedFragment } = extractFragmentData(queryFragment);
  return gql`
    query WithWebsiteSection($input: WebsiteSectionAliasQueryInput!, $redirect: WebsiteSectionRedirectQueryInput!) {
      websiteSectionAlias(input: $input) {
        ...WithWebsiteSectionFragment
        ${spreadFragmentName}
      }
      websiteSectionRedirect(input: $redirect) {
        ...WithWebsiteSectionFragment
        ${spreadFragmentName}
      }
    }
    ${defaultFragment}
    ${processedFragment}
  `;
};
exports.buildQuery = buildQuery;

/**
 * @param {ApolloClient} apolloClient The Apollo GraphQL client that will perform the query.
 * @param {object} params
 * @param {string} params.alias The website section alias to query.
 * @param {string} [params.queryFragment] The `graphql-tag` fragment
 *                                        to apply to the `websiteSectionAlias` query.
 * @param {object} [params.additionalInput] Additional query input params.
 */
module.exports = async (apolloClient, {
  alias,
  queryFragment,
  additionalInput,
} = {}) => {
  if (!alias) {
    // No website alias was provided. Return a 400.
    throw createError(400, 'No website section alias was provided.');
  }

  // Query for the website section (and any potential redirects) using the alias.
  const input = { ...additionalInput, alias };
  const variables = { input, redirect: input };
  const { data } = await apolloClient.query({ query: buildQuery({ queryFragment }), variables });

  const { websiteSectionAlias: section, websiteSectionRedirect: redirect } = data;

  if (section && section.alias) {
    // The website section was found.
    return section;
  }
  if (redirect && redirect.alias) {
    // A redirect was found for this section alias.
    return redirect;
  }
  // No website section or redirect was found for this alias. Return a 404.
  throw createError(404, `No website section was found for alias '${alias}'`);
};
