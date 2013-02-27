require('sugar');
var acquire = require('acquire')
  , Wrangler = acquire('endpoint-wrangler').Wrangler;

var testWrangler = function () {
  this.wrangler = new Wrangler();
  this.wrangler.on('finished', function onFinished(items) {
    console.log(items);
  });

  this.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
  this.wrangler.beginSearch('http://www.newtvworld.com/India-Live-Tv-Channels/Channel-One-live-streaming.html');
};

var test = new testWrangler();