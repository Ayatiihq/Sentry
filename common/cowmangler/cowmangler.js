"use strict";
/*
 * cowmangler.js
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('cowmangler.js')
  , util = require('util')
  , sugar = require('sugar')
  , URI = require('URIjs')  
  , Settings = acquire('settings')  
  , Campaigns = acquire('campaigns')
  , Ass = require('./ass.js')
  , all = require('node-promise').all
;

var Cowmangler = module.exports = function () {
  var connected = false;
  this.ass_ = null;
  this.cachedCalls_ = [];
  this.init();
}

util.inherits(Cowmangler, events.EventEmitter);

/*
  Cowmangler
*/
Cowmangler.prototype.init = function()
{
	var self = this;  
  self.ass_ = new Ass();
}

/*
  New tab
*/
Cowmangler.prototype.newTab = function(){
  var self = this;

  function done(err){
    if(err)
      return self.emit("error", err);
    self.connected = true;
    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });

    self.emit('ready');
  }

  self.ass_.new(done);
}

/*
   Get
 * @param {string}    uri            target URI.
 * @param {function}  done           callback to notify once we are up and talking to cowmangler.
 * @param {object}    options        Optional options to pass along with the URI to the get command - like 
                                     {waitTimeout: 20000}
 **/
Cowmangler.prototype.get = function(uri, done, options){
  var self = this;
  
  if (!self.connected)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  var data = Object.merge({'value': uri}, options);

  self.ass_.do('open', data).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/*
   Get Infringement - Get's the URI you suspect to be an infringement. 
   It returns a result with two key/value pairs (format - {result: bool, redirects: []})
    - result, true => a directDownload, false => a page.
    - directDownloads, an array of redirects that happened as a result of the get.
 * @param {string}    uri            target URI.
 * @param {function}  done           callback to notify once we are up and talking to cowmangler.                                  
 **/
Cowmangler.prototype.getInfringement = function(uri, done){
  var self = this;
  
  if (!self.connected)
    return self.cachedCalls_.push([self.getInfringement, Object.values(arguments)]);

  var data = {'value': uri, 'delay': 5000};

  self.ass_.do('openInfringement', data).then(function(result){
    done(null, result);
  },
  function(err){
    done(err);
  });
}

/*
 * Click
 * @param {string}    selector       the selector by which to identify the element to click
 * @param {function}  done           callback to notify once we are up and talking to cowmangler.
 **/
Cowmangler.prototype.click = function(selector, done, timeout){
  var self = this;
  var delay = timeout;

  if(!timeout)
    delay = 0;

  if (!self.connected)
    return self.cachedCalls_.push([self.click, Object.values(arguments)]);

  self.ass_.do('click', {'selector': selector, 'delay': delay}).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/*
 * Input
 * @param {Object}    credentials    The credentials for the particular input {'selector': '', 'value' : ''},
*/
Cowmangler.prototype.input = function(credentials, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.input, Object.values(arguments)]);

  self.ass_.do('input', credentials).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/*
   Submit
 * @param {string}    selector       the selector by which to identify the element to submit on.
 * @param {function}  done           callback to notify once we are up and talking to cowmangler.
 **/
Cowmangler.prototype.submit = function(selector, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.submit, Object.values(arguments)]);

  self.ass_.do('submit', {'selector': selector}).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/* 
 * Establishes the rules for downloading i.e. minSize & mimeTypes to filter by.
 * It should be noted that some URIs will result in an automatic download. Therefore it is important that this method is called 
 * before you get a suspected infringement and then call any one of the following: downloadAll, downloadTargeted, downloadLinks. 
 * @param {string}          uri       The URI that you will get after calling this. (we need to record signals against this uri)
 * @param {float}           minSize   The minimum size used to disregard downloads.
 * @param {array[''...]}    mimeTypes Array of mimeTypes (depending on the campaign)
 * @param {function}        done      Callback to notify once we are done talking to cowmangler.  
 */
Cowmangler.prototype.setDownloadPolicy = function(uri, minSize, mimeTypes, done){
  var self = this;

  // Add the mimeTypes that we always want to pick up regardless of campaign type.
  mimeTypes = mimeTypes.union(["/octet-stream", "/zip", "/rar"]);

  if (!self.connected)
    return self.cachedCalls_.push([self.setDownloadPolicy, Object.values(arguments)]);
  //logger.info('Set DownloadPolicy ' + JSON.stringify(mimeTypes));
  var data = {'minsize': minSize, 'mimetypes' : mimeTypes};
  self.ass_.do('setDownloadPolicy', data).then(function(result){
    self.ass_.addSource(uri);
    done();
  },
  function(err){
    done(err);
  });
}

/*
   getStoredDownloads
 * @param {function}  done           callback to notify once we are done talking to cowmangler.
                                     returns an array of download objects that have been downloaded for this URI.
 **/
Cowmangler.prototype.getStoredDownloads = function(uri, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.getStoredDownloads, Object.values(arguments)]);

  self.ass_.getHooverBag(uri).then(function(downloads){
    done(null, downloads);
  },
  function(err){
    done(err);
  });  
}

/* 
 * This results in CowMangler attempting to download files resulting from preceding clicks.
 * Usual usecase is to click a few places and then call downloadTargeted, then listen to redis for signals. 
 * @param {function}  done           callback to notify once we are done talking to cowmangler. 
 */
Cowmangler.prototype.downloadTargeted = function(uri, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.downloadTargeted, Object.values(arguments)]);

  // First open the ears.
  self.getStoredDownloads(uri, done);

  self.ass_.do('downloadTargeted', {}).then(function(result){
    logger.info('open the signals flood gate !');
  },
  function(err){
    done(err);
  });
}

/* 
 * This results in CowMangler attempting to download each ahref on a page. 
 * @param {function}  done           callback to notify once we are done talking to cowmangler. 
 */
Cowmangler.prototype.downloadLinks = function(done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.downloadLinks, Object.values(arguments)]);

  self.ass_.do('downloadLinks', {}).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/* 
 * Convenience function which results in downloadTargeted and downloadLinks being called. 
 * @param {function}  done           callback to notify once we are done talking to cowmangler. 
 */
Cowmangler.prototype.downloadAll = function(done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.downloadAll, Object.values(arguments)]);

  self.ass_.do('downloadAll', {}).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

/*
   GetSource
 * @param {function}  done           callback to notify once we are done talking to cowmangler.
                                     returns a string of the base source
 **/
Cowmangler.prototype.getSource = function(done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.getSource, Object.values(arguments)]);

  self.ass_.do('getSource', {}).then(function(results){
    done(null, results.result);
  },
  function(err){
    done(err);
  });
}

/*
   GetSources
 * @param {function}  done           callback to notify once we are done talking to cowmangler.
                                     returns an array of strings including the base source plus others 
 **/
Cowmangler.prototype.getSources = function(done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.getSources, Object.values(arguments)]);

  self.ass_.do('getSources', {}).then(function(sources){
    done(null, sources.result);
  },
  function(err){
    done(err);
  });
}

/*
   Find
 * @param {string}    selector       the selector by which to identify the element
 * @param {function}  done           callback to notify once we done talking to cowmangler.
 **/
Cowmangler.prototype.find = function(selector, done){
  var self = this;
  var data = {"selector": selector};

  if (!self.connected)
    return self.cachedCalls_.push([self.find, Object.values(arguments)]);

  self.ass_.do('find', data).then(function(result){
    done();
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.quit = function(done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.quit, Object.values(arguments)]);
  
  self.ass_.deafen().then(function(){
    self.ass_.do('destroy', {}).then(function(result){
      logger.info('browser destroyed');
      done();
    },
    function(err){
      done(err);
    });     
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.injectJs = function(js, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.injectJs, Object.values(arguments)]);

  var payload = {value: js};
  self.ass_.do('addPreLoadInjection', payload).then(function(result){
    done();
  },
  function(err){
    done(err);
  });  
}

Cowmangler.prototype.removeJs = function(scriptId, done){
  var self = this;
  
  if (!self.connected)
    return self.cachedCalls_.push([self.removeJs, Object.values(arguments)]);
 
  var payload = {value: scriptId};
  self.ass_.do('removePreLoadInjection', payload).then(function(result){
    done();
  },
  function(err){
    done(err);
  });  
}

Cowmangler.prototype.setAdBlock = function(turnOn, done){
  var self = this;

  if (!self.connected)
    return self.cachedCalls_.push([self.setAdBlock, Object.values(arguments)]);

  var payload = {value: turnOn};
  self.ass_.do('setAdBlock', payload).then(function(result){
    done();
  },
  function(err){
    done(err);
  });  
}

/*
 * Wait
 * @param {integer}   waitTime      The waitTime (milliseconds) to stall CW by. 
 */
Cowmangler.prototype.wait = function(waitTime, done){
  var self = this;
  if (!self.connected)
    return self.cachedCalls_.push([self.wait, Object.values(arguments)]);
  var payload = {value: waitTime};
  self.ass_.do('wait', payload).then(function(result){
    done();
  },
  function(err){
    done(err);
  });  
}

Cowmangler.prototype.setUserAgent = function(userAgent, done){
  var self = this;
  var data = {"value": userAgent};

  if (!self.connected)
    return self.cachedCalls_.push([self.setUserAgent, Object.values(arguments)]);

  self.ass_.do('setUserAgent', data).then(function(){
     done();
   },
   function(err){
     done(err);
  });
}

Cowmangler.prototype.getOuterHTML = function(selector, done){
  var self = this;
  var data = {"selector": selector};

  if (!self.connected)
    return self.cachedCalls_.push([self.getOuterHTML, Object.values(arguments)]);

  self.ass_.do('getOuterHTML', data).then(function(html){
    done(null, html.result);
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.getInnerHTML = function(selector, done){
  var self = this;
  var data = {"selector": selector};

  if (!self.connected)
    return self.cachedCalls_.push([self.getInnerHTML, Object.values(arguments)]);

  self.ass_.do('getInnerHTML', data).then(function(html){
    done(null, html.result);
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.loadHTML = function(html, done){
  var self = this;
  var data = {"value": html};

  if (!self.connected)
    return self.cachedCalls_.push([self.loadHTML, Object.values(arguments)]);

  self.ass_.do('loadHTML', data).then(function(){
    done();
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.isAvailable = function(done){
  if (!self.connected)
    return self.cachedCalls_.push([self.isAvailable, Object.values(arguments)]);

  self.ass_.query('isNodeAvailable').then(function(results){
    done(null, results.result);
  },
  function(err){
    done(err);
  });
}

Cowmangler.prototype.getStatus = function(done){
  if (!self.connected)
    return self.cachedCalls_.push([self.getStatus, Object.values(arguments)]);

  self.ass_.query('getNodes').then(function(results){
    done(null, results.result);
  },
  function(err){
    done(err);
  });
}
