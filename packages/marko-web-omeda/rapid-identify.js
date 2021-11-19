const gql = require('graphql-tag');

const RAPID_IDENT = gql`
  mutation RapidIdentityX($input: RapidCustomerIdentificationMutationInput!) {
    result: rapidCustomerIdentification(input: $input) { id encryptedCustomerId }
  }
`;

const { isArray } = Array;

module.exports = async (omedaGraphQLClient, {
  email,
  productId,

  firstName,
  lastName,
  companyName,
  title,

  regionCode,
  countryCode,
  postalCode,

  deploymentTypeIds,
  demographics,

  promoCode,
} = {}) => {
  const input = {
    productId,
    email,
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(companyName && { companyName }),
    ...(title && { title }),

    ...(regionCode && { regionCode }),
    ...(countryCode && { countryCode }),
    ...(postalCode && { postalCode }),

    ...(isArray(deploymentTypeIds) && deploymentTypeIds.length && { deploymentTypeIds }),
    ...(isArray(demographics) && demographics.length && { demographics }),

    ...(promoCode && { promoCode }),
  };
  const { data } = await omedaGraphQLClient.mutate({
    mutation: RAPID_IDENT,
    variables: { input },
  });
  return data.result;
};