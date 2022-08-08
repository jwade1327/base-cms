const { withContent, withWebsiteSection } = require('@parameter1/base-cms-marko-web/middleware');
const renderBlock = require('@parameter1/base-cms-marko-web-theme-monorail/routes/render-block');
const search = require('@parameter1/base-cms-marko-web-theme-monorail/routes/search');
const print = require('@parameter1/base-cms-marko-web-theme-monorail/routes/print');
const nativeX = require('./native-x');

const index = require('../templates/index');
const content = require('../templates/content');
const section = require('../templates/section');
const leaders = require('../templates/leaders');

const queryFragment = require('../../graphql/fragments/content-page');
const sectionFragment = require('../../graphql/fragments/website-section-page');

module.exports = (app, config) => {
  // NativeX
  nativeX(app);

  // Monorail
  renderBlock(app);

  search(app, config);

  app.get('/', (_, res) => {
    res.marko(index);
  });

  // Content
  print(app, queryFragment);
  app.get('/*?:id(\\d{8})*', withContent({
    template: content,
    queryFragment,
  }));

  // Sections
  app.get('/:alias(leaders)', withWebsiteSection({
    template: leaders,
    queryFragment: sectionFragment,
  }));
  app.get('/:alias([a-z0-9-/]+)', withWebsiteSection({
    template: section,
    queryFragment: sectionFragment,
  }));
};
