import gql from 'graphql-tag';

export default gql`

query LeadersScheduledContent($input: WebsiteScheduledContentQueryInput!) {
  websiteScheduledContent(input: $input) {
    edges {
      node {
        id
        name
        siteContext {
          path
        }
        ... on SocialLinkable {
          socialLinks {
            provider
          }
        }
        primaryImage{
          id
          src(input: { options: { auto: "format", fillColor: "fff", fit: "fill", bg: "fff", pad: 20, h: 200, w: 200, borderRadius: "200,200,200,200", border: "10,fff" } })
        }
        ... on ContentCompany {
          productSummary
          publicContacts(input: { pagination: { limit: 1 } }) {
            edges {
              node {
                id
                name
                title
                primaryImage {
                  id
                  src(input: { options: { auto: "format", h: 100, w: 100, mask: "ellipse", fit: "facearea", facepad: 3 } })
                }
              }
            }
          }
          teaser(input: { maxLength: 0 })
          website
          promotions: relatedContent(input: { queryTypes: [company], includeContentTypes: [Promotion] }){
            edges {
              node {
                id
                name
                primaryImage{
                  id
                  src(input: { options: { auto: "format", fit: "crop", h: 90, w: 120 } })
                }
                ... on ContentPromotion {
                  linkUrl
                  linkText
                }
              }
            }
          }
          youtube {
            username
            channelId
          }
          videos: youtubeVideos(input: { pagination: { limit: 4 } }) {
            edges {
              node {
                id
                url
                title
                thumbnail
              }
            }
          }
        }
      }
    }
  }
}
`;
