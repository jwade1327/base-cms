const { extractFragmentData } = require('@parameter1/base-cms-web-common/utils');
const gql = require('graphql-tag');

module.exports = (queryFragment) => {
  const { spreadFragmentName, processedFragment } = extractFragmentData(queryFragment);
  return gql`
    query MarkoWebStoryPage($input: PublishedStoryInput!) {
      publishedStory(input: $input) {
        id
        ${spreadFragmentName}
      }
    }
    ${processedFragment}
  `;
};
