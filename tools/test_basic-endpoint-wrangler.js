require('sugar');
var acquire = require('acquire')
  , Wrangler = acquire('basic-endpoint-wrangler').Wrangler;

var testWrangler = function () {
  var self = this;
  this.wrangler = new Wrangler();
  /* when the wrangler is finished scraping, it emits the finished signal with all the found items
   */
  this.wrangler.on('finished', function onFinished(items) {
    console.log(items);
    self.wrangler.quit();
  });

  /* we add the scrapersLiveTV scraper collection to the wrangler, this is a collection of scrapers, 
   * as of right now it is defined as:
   
      module.exports.scrapersLiveTV = [module.exports.scraperEmbed,
                                       module.exports.scraperObject,
                                       module.exports.scraperRegexStreamUri];
   */
  this.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);

  /* the page we search on 
   * it should be noted that the wrangler will create its own selenium client and thus you should be 
   * careful not to make too many objects. once the finished event is emitted you can do another search with the same
   * wrangler client
   */
  //this.wrangler.beginSearch('http://www.newtvworld.com/India-Live-Tv-Channels/Channel-One-live-streaming.html');
  this.wrangler.beginSearch('http://www.newtvworld.com/India-Live-Tv-Channels/bbc-world-news-live-streaming.html');
};

var test = new testWrangler();