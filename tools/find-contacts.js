"use strict";
/*jslint white: true */
require('sugar');
var all = require('node-promise').all
  , cheerio = require('cheerio')
  , dns = require('dns')
  , Promise = require('node-promise')
  , readline = require('readline')
  , request = require('request')
  , traceroute = require('traceroute')
  , URI = require('URIjs')
  , when = require('node-promise').when
  , whois = require('node-whois')
  , XRegExp = require('xregexp').XRegExp
;

// most readable regular expression ever.
// basically it just matches foo@bar.com and foo [ at ] bar [ dot ] com
var emailRegex = XRegExp("(?<name>[A-Za-z0-9_\\.]+)[ \t]*(@|\\[[ \t]*at[ \t]*\\]|\\([ \t]*at[ \t]*\\))[ \t]*(?<domain>[A-Za-z0-9_\\-]+)[ \t]*(\\.|\\[[ \t]*dot[ \t]*\\]|\\([ \t]*dot[ \t]*\\))[ \t]*(?<tld>[A-Za-z]+)", "gi");

/*
var teststring = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.  contact [at] world4freeus.com  Vestibulum sollicitudin contact @ test . com velit iaculis odio facilisis semper. contact@test.com  Mauris in ipsum nibh. Ut elementum rutrum mi, vel dictum tortor cursus ac. Donec tempor, velit in ornare volutpat, justo eros tincidunt sapien, sit amet auctor tellus est ut urna. Integer dictum adipiscing nisi porttitor elementum. Maecenas non porttitor lacus. Mauris vestibulum egestas erat.\
Phasellus bibendum dolor a tristique vehicula. Etiam id euismod tortor. Maecenas et posuere tortor. Quisque sagittis, eros vel eleifend bibendum, eros enim lobortis quam, volutpat luctus nibh erat non odio. Aliquam consequat vehicula risus eu semper. Etiam eget euismod massa. Nullam mollis sapien purus, sit amet feugiat sapien cursus et. Curabitur at fermentum nulla. Aliquam aliquam risus et lectus tincidunt, sed bibendum nisl porttitor. Vivamus fermentum pharetra odio vel vehicula. Cras id urna eget enim bibendum aliquam a eget metus. Aliquam id aliquam arcu.\
Duis non malesuada leo. Nullam laoreet porta vulputate. Cras pharetra purus risus, ut laoreet est euismod id. Vestibulum et cursus urna. Maecenas at support @ filecloud.io leo vitae sem fermentum varius tempor vel neque. Nullam lacinia a sapien sit amet rhoncus. Phasellus sodales ac quam a rhoncus. Maecenas at libero ac mi sollicitudin sodales in eu urna. Quisque laoreet luctus neque, quis commodo magna suscipit sit amet. Sed at condimentum est. Curabitur neque dolor, euismod ac sollicitudin in, posuere ac mi. Donec tempor purus elementum malesuada varius. Nunc eu viverra urna. Pellentesque nulla justo, sagittis vitae molestie eu, laoreet id velit. Integer pulvinar nec nibh id fringilla.\
Suspendisse iaculis leo ac dolor pellentesque, vel porttitor quam ullamcorper. contact [at] test [dot] com tIn dapibus magna in risus vulputate, at contact [at] world4freeus.com porttitor orci semper. Praesent ultrices, elit nec consectetur venenatis, quam purus tristique arcu, et dignissim risus neque non dui. Duis vitae consequat urna, facilisis adipiscing orci. Donec gravida nisi non dignissim interdum. Suspendisse potenti. Praesent eget leo ac lorem mattis pellentesque. Nam diam mauris, ultrices id risus sed, ultricies eleifend est. Proin vitae enim rhoncus dui semper lobortis vitae vitae dolor. Mauris id auctor tortor, sit amet tincidunt dui. Pellentesque viverra, nulla eget feugiat eleifend, nulla arcu interdum eros, at vehicula lorem elit id nisl. Nullam vehicula volutpat elit vel porta. Aenean vehicula felis libero, nec interdum urna sollicitudin id. Maecenas tristique velit neque, quis rhoncus metus commodo vitae.\
Quisque congue ultricies suscipit. Integer dapibus nulla at urna gravida foo ( at ) roar [ dot ] com molestie. Proin eu ligula ante. Vivamus vel risus et elit elementum congue ut sit amet nisl. Integer facilisis turpis sit amet justo tincidunt tincidunt id nec ipsum. Nunc scelerisque augue nulla. Donec condimentum dolor eget sapien interdum tempor. "

XRegExp.forEach(teststring, emailRegex, function (match) {
  console.log(match[0], transformEmail(match));
})
*/

function transformEmail(match) {
  return match.name + "@" + match.domain + "." + match.tld;
}

function saveJson(json, name) {
  require('fs').writeFile('json/' + name + '.json', JSON.stringify(json), function (err) {
    if (err) { console.log(err); }
    else { console.log("Json Saved to: " + name + '.json'); }
  });
}

function getResponse(message) {
  var promise = new Promise.Promise();
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(message, function (result) {
    rl.close();
    promise.resolve(result);
  });

  return promise;
}

function multiChoose(message, things, defaultIndex) {
  var promise = new Promise.Promise();
  console.log(message);
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  things.each(function (thing, index) {
    var check = '[' + ((index === defaultIndex) ? 'x' : ' ') + '] '
    var thingText = (!Array.isArray(thing)) ? thing.toString() : '';
    if (Array.isArray(thing)) { thing.each(function (txt) { thingText = thingText + ': ' + txt; }); }
    console.log(index + ', ' + check + thingText);
  });

  function changeChoice() {
    return getResponse('New choice (-1 deselects): ').then(function (result) {
      if (result < 0) { promise.resolve(); }
      else { promise.resolve(things[result]); }
    });
  }

  if (defaultIndex < 0 || defaultIndex !== undefined) {
    getResponse('Is the default correct? (y/n): ').then(function (result) {
      if (result.toLowerCase() === 'y') { promise.resolve(things[defaultIndex]); }
      else {
        changeChoice();
      }
    });
  }
  else {
    changeChoice();
  }

  return promise;
};

function getPageTitle(ip) {
  var promise = new Promise.Promise();
  request('http://' + ip, {}, function (error, response, body) {
    var $ = cheerio.load(body);
    var title = $('title').text();
    promise.resolve({ 'ip': ip, 'title': title });
  });

  return promise;
}

function reverseIP(ip) {
  var promise = new Promise.Promise();
  dns.reverse(ip, function (err, domains) {
    promise.resolve({ 'ip': ip, 'domains': domains });
  });
  return promise;
};

function unfuckTracerouteAPI(hops) {
  // christ, what a retard.
  var newHops = hops.map(function (hop) {
    return Object.keys(hop)[0];
  });

  return newHops;
};

function doTraceRoute(hostname) {
  var promise = new Promise.Promise();

  traceroute.trace(hostname, function (err, hops) {
    if (err) { promise.reject(err); }
    else {
      hops = unfuckTracerouteAPI(hops);
      // expand the ips into reverse addresses
      var reverseLookupPromises = hops.map(reverseIP);
      Promise.all(reverseLookupPromises).then(function onAllResolved(results) {
        // promises might not be in the right order, so lets ensure they are
        results = results.sortBy(function (result) {
          return hops.findIndex(result.ip);
        });

        promise.resolve(results);
      });
    }
  });
  return promise;
}

function findNameOfTraceroute(hops) {
  var promise = new Promise.Promise();
  var collection = [];

  hops.each(function (hop, index) {
    var titlePromise = getPageTitle(hop.ip);
    collection.push(titlePromise);
  });

  Promise.all(collection).then(function onAllTitlePages(results) {
    results.each(function (result) {
      hops.find({ 'ip': result.ip }).title = result.title;
    });

    promise.resolve(hops);
  });

  return promise;
}

function doWhois(uri) {
  var promise = new Promise.Promise();
  var collectedEmails = [];
  // no good emails yet, look at whois.
  whois.lookup(uri, function (whoisErr, whoisBody) {
    XRegExp.forEach(whoisBody, emailRegex, function (match) {
      collectedEmails.push({ address: transformEmail(match), source: 'whois' });
    });
    promise.resolve(collectedEmails);
  })

  return promise;
}

function doContactPage(uri) {
  var promise = new Promise.Promise();
  var collectedEmails = [];
  if (uri) {
    request(uri, {}, function (contactError, contactResponse, contactBody) {
      XRegExp.forEach(unescape(contactBody), emailRegex, function (match) {
        collectedEmails.push({ address: transformEmail(match), source: uri });
      });

      promise.resolve(collectedEmails);
    })
  }
  else {
    console.log('DEBUG: no uri given to doContactPage');
    promise.resolve([]);
  }
  return promise;
}

function doMainPage(uri) {
  var promise = new Promise.Promise();
  var collectedEmails = [];

  request(uri, {}, function (error, response, body) {
    var $ = cheerio.load(body);
    // look for emails right on the main page

    XRegExp.forEach(unescape(body), emailRegex, function (match) {
      collectedEmails.push({ address: transformEmail(match), source: 'main' });
    });
      
    var contactPages = [];

    $('a').each(function(index, element) {
      var content = $(this).text();
      content = content + ' ' + $(this).attr('href');
      if (/(contact|dmca|copyright|legal|disclaimer|terms of service|abuse)/i.exec(content))
      {
        var href = $(this).attr('href');
        try { 
          var composedURI = URI(href).absoluteTo(uri).toString();
          contactPages.push(composedURI);
        } catch (err) { } 
      }

    });

    promise.resolve([collectedEmails, contactPages])
  });

  return promise;
}

var SiteInfoBuilder = function (hostname) {
  var self = this;
  self.hostname = hostname;
  self.emails = [];
  self.contactPages = [];
  self.hops = [];
};

SiteInfoBuilder.prototype.addEmails = function (emails) {
  var self = this;
  emails = emails.compact();
  emails.each(function (data) { data.address = data.address.toLowerCase(); });
  self.emails = self.emails.concat(emails);
  self.emails = self.emails.unique('address');
}

SiteInfoBuilder.prototype.addContactPages = function (contactPages) {
  var self = this;
  contactPages = contactPages.compact();
  self.contactPages = self.contactPages.concat(contactPages);
  self.contactPages = self.contactPages.unique();
}

SiteInfoBuilder.prototype.collectInfo = function () {
  var self = this;
  var promise = new Promise.Promise();
  var weburi = self.hostname;

  console.log('scraping information...');

  // some uris didn't start with www but the site needed www because its developed by idiots
  // we should get the full hostname in future but for now, this hacky hack.
  // match makes sure there isn't a subhost already
  if (!weburi.startsWith('www.') && weburi.match(/\./g).length < 2) {
    weburi = 'www.' + weburi;
  }

  if (!weburi.startsWith('http')) {
    weburi = "http://" + weburi;
  }

  // gets the emails on the main page and finds contact pages
  var mainPagePromise = doMainPage(weburi).then(function onMainPage(results) {
    var newEmails = results[0];
    var newContactPages = results[1];
    self.addEmails(newEmails);
    self.addContactPages(newContactPages);

    console.log('scraped main page...');
  });

  // looks up the whois
  var whoisPromise = doWhois(self.hostname).then(function onWhoisDone(newEmails) {
    self.addEmails(newEmails);

    console.log('scraped whois...');
  });

  // look up traceroute
  var tracePromise = doTraceRoute(self.hostname).then(findNameOfTraceroute).then(function (results) {
    self.hops = results;
    console.log('scraped traceroute...');
  });

  Promise.all([mainPagePromise, whoisPromise, tracePromise]).then(function onDone() {
    if (self.contactPages.length < 1) {
      promise.resolve();
    }
    else {
      var collectedPromises = [];
      self.contactPages.each(function (contactPageUri) {
        var promise = doContactPage(contactPageUri);
        collectedPromises.push(promise);
      });

      Promise.all(collectedPromises).then(function onContactPagesDone(results) {
        results.each(function (newEmails) {
          self.addEmails(newEmails);
        });

        console.log('scraped contact pages...');

        promise.resolve();
      });
    }
  });

  return promise;
};

SiteInfoBuilder.prototype.talkToUser = function() {
  var self = this;
  var formattedEmails = self.emails.map(function (data) { return [data.address, data.source]; });
  var formattedHops = self.hops.map(function (data) {
    if (data.title === undefined) { return ''; }
    return (data.title.trim() !== '' && !data.ip.startsWith('192.168')) ? [data.ip, data.title.trim()] : '';
  }).compact(true);
 
  var questions = [];

  var chosenEmail = undefined;
  var chosenHost = undefined;

  if (formattedEmails.length > 0) {
    var match = /contact|dmca|abuse/;
    var defaultIndex = formattedEmails.findIndex(function (email) {
      return match.exec(email[0]);
    });

    if (defaultIndex < 0) {
      return match.exec(email[1]);
    }

    if (defaultIndex < 0) { defaultIndex = 0; } 
    
    questions.push(function () {
      return multiChoose('collected emails', formattedEmails, defaultIndex).then(function (email) {
        if (email) {
          chosenEmail = email[0];
        }
      });
    });
  }

  if (formattedHops.length > 0) {
    var defaultIndex = (formattedHops.length === 1) ? 0 : (formattedHops.length - 2);
    questions.push(function () {
      return multiChoose('collected hosts', formattedHops, defaultIndex).then(function (host) {
        if (host) {
          chosenHost = host[1];
        }
      });
    });
  }

  if (questions.length < 1) {
    console.log('Could not find any useful information, info dump:');
    console.log(self.emails);
    console.log(self.hops);
    console.log(self.contactPages);
  }
  else {
    Promise.seq(questions).then(function () {
      var basicJson = {
        "_id": self.hostname,
        "name": self.hostname,
        "uri": self.hostname,
        "noticeDetails": {
          "batch": true,
          "batchMaxSize": 0,
          "metadata": {
            "template": "dmca",
            "to": chosenEmail
          },
          "triggers": {
            "minutesSinceLast": 180
          },
          "type": "email",
          "testing": false
        },
        "hostedBy": chosenHost
      };

      saveJson(basicJson, self.hostname);
    });
  }
}


if (require.main === module) {
  if (process.argv.length < 3) {
    console.log("Usage: node find-contacts.js websiteurl");
  }
  else {
    var hostname = process.argv[2];

    var siteInfo = new SiteInfoBuilder(hostname);
    siteInfo.collectInfo().then(siteInfo.talkToUser.bind(siteInfo));
  }
  
}