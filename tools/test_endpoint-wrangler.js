require('sugar');
var acquire = require('acquire')
  , Wrangler = acquire('endpoint-wrangler').Wrangler
  , rulesDownloadsMusic = acquire('wrangler-rules').rulesDownloadsMusic;
  , rulesLiveTV = acquire('wrangler-rules').rulesLiveTV;

var testWrangler = function () {
  var self = this;
  this.wrangler = new Wrangler();
  /* when the wrangler is finished scraping, it emits the finished signal with all the found items
   */
  this.wrangler.on('finished', function onFinished(items) {
    console.log(items);
    self.wrangler.quit();
  });

  this.wrangler.on('error', function onWranglerError(error) {
    console.log('got wrangler error');
    console.log(error);
  });

  this.wrangler.addRule(rulesDownloadsMusic);

  /* the page we search on 
   * it should be noted that the wrangler will create its own selenium client and thus you should be 
   * careful not to make too many objects. once the finished event is emitted you can do another search with the same
   * wrangler client
   */
  //this.wrangler.beginSearch('http://www.newtvworld.com/India-Live-Tv-Channels/Channel-One-live-streaming.html');
  this.wrangler.beginSearch('http://mooviezworld.blogspot.ie/2012/01/download-legends-of-fall-1994-brrip.html');
  //this.wrangler.beginSearch('http://nowwatchtvlive.com/2011/07/zee-tv-live-watch-zee-tv-online-watch-zee-tv-free/');
};

var test = new testWrangler();