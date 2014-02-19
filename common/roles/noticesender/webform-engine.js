/*
 * webform-engine.js: the email-engine
 *
 * (C) 2013 Ayatii Limited
 *
 * WebFormEngine sends notices to hosts with webforms.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('webform-engine.js')
  , Q = require('q')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
;

var resource = require('./webform-engine-resource');

var TAKE_SCREENSHOTS = true;

// very simple wrapper around our browser calls, so we can replace with cow at some point
var BrowserEngine = function () {
  var self = this;
  events.EventEmitter.call(self);

  self.driver = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                             .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' })
                             .build();

}
util.inherits(BrowserEngine, events.EventEmitter);

BrowserEngine.prototype.getDriver = function () { return this.driver; }

// if selectorToWaitFor is returned, will wait for that selector to be true before resolving
BrowserEngine.prototype.gotoURL = function (url, selectorToWaitFor) {
  var self = this;
  var deferred = new Q.defer();
  if (url === undefined) { deferred.reject(new Error('url is undefined')); return deferred.promise; }
  logger.trace(url);

  var seleniumPromise = self.driver.get(url);

  if (selectorToWaitFor !== undefined) {
  //  var selector = webdriver.By.css(selectorToWaitFor);
  //  seleniumPromise = seleniumPromise.then(self.driver.findElement.bind(self.driver, selector));
  }
  if (TAKE_SCREENSHOTS) { self.debugScreenshot((Date.now() / 1000).toString() + '.png') };
  seleniumPromise.then(deferred.resolve, deferred.reject);
  return deferred.promise.delay(5000); // delay 5 seconds to allow it to load
}

// I forget why i really added this, it doesn't do much
BrowserEngine.prototype.sleep = function (timeout) {
  return Q.delay(timeout);
}

// fills the selector with text, returns a promise
BrowserEngine.prototype.fillTextBox = function (selector, text) {
  var self = this;
  var deferred = new Q.defer();
  if (selector === undefined) { deferred.reject(new Error('selector is undefined')); return deferred.promise;}
  logger.trace(selector, text);

  self.driver.findElement(webdriver.By.css(selector)).sendKeys(text).then(deferred.resolve, deferred.reject);
  if (TAKE_SCREENSHOTS) { self.debugScreenshot((Date.now() / 1000).toString() + '.png') };

  return deferred.promise;
}

// checks a checkbox, returns a promise
BrowserEngine.prototype.checkBox = function (selector) {
  var self = this;
  var deferred = new Q.defer();
  logger.trace(selector);

  self.driver.findElement(webdriver.By.css(selector)).click().then(deferred.resolve, deferred.reject);
  if (TAKE_SCREENSHOTS) { self.debugScreenshot((Date.now() / 1000).toString() + '.png') };

  return deferred.promise;
}

// not really any different than .click but is good to keep distinct for tracing
BrowserEngine.prototype.submit = function (selector) {
  var self = this;
  logger.trace(selector);
  /*var deferred = new Q.defer();
  deferred.resolve();
  return deferred.promise; 
  */
  return self.click(selector);
}

// clicks the selector provided, returns a promise
BrowserEngine.prototype.click = function (selector) {
  var self = this;
  var deferred = new Q.defer();
  logger.trace(selector);

  self.driver.findElement(webdriver.By.css(selector)).click().then(deferred.resolve, deferred.reject);
  if (TAKE_SCREENSHOTS) { self.debugScreenshot((Date.now() / 1000).toString() + '.png') };

  return deferred.promise;
}

// TODO: make this actually work
BrowserEngine.prototype.comboBox = function (selector, selection) {
  var self = this;
  var deferred = new Q.defer();
  logger.trace(selector, selection);
  deferred.resolve();

  return deferred.promise;
}

BrowserEngine.prototype.debugScreenshot = function (location) {
  var self = this;
  var deferred = new Q.defer();
  self.driver.takeScreenshot().then(function (data) {
    logger.info('saving screenshot to %s', location);
    fs.writeFileSync(location, data, { encoding: 'base64' });
  }).then(deferred.resolve, deferred.reject);

  return deferred.promise;
}

// make sure to call this if there are any promise failures
BrowserEngine.prototype.quit = function () {
  var self = this;
  self.driver.quit();
}

var WebFormEngine = module.exports = function () {
  this.init();
}

util.inherits(WebFormEngine, events.EventEmitter);

WebFormEngine.prototype.init = function () {
  var self = this;
  self.browser = new BrowserEngine();
}

// turn this to true to get a screenshot instead of a form submission
var debug = true;

// takes a string action and a selector and returns a correctly bound function ready for Q
WebFormEngine.prototype.actionBuilder = function (action, selector) {
  var self = this;
  var actionFunction = function () { logger.error(new Error('returned an undefined action in actionBuilder: ' + action)); };

  switch (action) {
    case 'click':
      actionFunction = self.browser.click.bind(self.browser, selector);
      break;
    default:
      logger.error('got a weird action: %s(%s)', action, selector);
      break;
  }

  return actionFunction;
}

// The grunt work of the code, executes the formTempalate given
WebFormEngine.prototype.executeForm = function (formTemplate, info) {
  var self = this;
  var deferred = Q.defer();

  logger.trace(formTemplate, info);

  var combinedInfo = Object.merge(resource.constants, info);

  //check for error and early exit if we find one
  var error = null;

  Object.keys(combinedInfo).each(function(key) {
    var test = combinedInfo[key];
    if (test === undefined || test === '' || test === null) {
      // can't just test for false, maybe 0 is okay
      logger.warn('Unable to complete web form notice sending, key failed -> ' + key);
      error = true;
    }
  });

  if (error) { 
    deferred.reject(new Error('Not submitting notice, input is malformed: ' + self.infringements + ' : ' + self.campaign));
    return deferred.promise;
  }

  // essentially a list of functions that return promises;
  var commandFunctions = [];
  var addCommand = function () {
    var args = Array.prototype.slice.call(arguments);
    var fn = args.shift();
    args.unshift(self.browser);
    commandFunctions.push(fn.bind.apply(fn, args));
  };

  // goto the url
  addCommand(self.browser.gotoURL, formTemplate.url, formTemplate.waitforSelector);
  
  Object.each(formTemplate.preActions, function preActions(action, selector) {
    addCommand(self.actionBuilder(action, selector));
  });

  // create all the text filling commands
  Object.each(formTemplate.formText, function addTextToForm(selector, text) {
    text = acquire('logger').dictFormat(text, combinedInfo);
    addCommand(self.browser.fillTextBox, selector, text);
  });

  // same with checkboxes, check any that are in our selectors
  Object.each(formTemplate.formCheckBoxes, function checkBoxes(selector) {
    addCommand(self.browser.checkBox, selector);
  });

  // do the actions 
  Object.each(formTemplate.actions, function actions(action, selector) {
    addCommand(self.actionBuilder(action, selector));
  });

  // finally, if we have a specificOverride function in our form, execute that, it should return a promise
  // the specificOverride thing sucks, but there isn't a super nice way around it :(

  if (Object.has(formTemplate, 'specificOverride')) {
    commandFunctions.push(formTemplate.specificOverride.bind(self, combinedInfo));
  }

  commandFunctions.reduce(Q.when, Q()).then(function finishedForm() {
    logger.trace();
    return self.browser.submit(formTemplate.submit).delay(5000);
  }).then(function () {
    self.browser.quit();
    deferred.resolve();
  }).fail(function (err) {
    deferred.reject(err);
    self.browser.quit();
  });

  return deferred.promise;
}


WebFormEngine.selectForm = function (host) {
  var self = this;
  var selectedForm = null;

  selectedForm = Object.find(resource.forms, function (formName, form) {
    return form.dynamicMatcher(host);
  });

  return (selectedForm !== null) ? resource.forms[selectedForm] : null;
}

WebFormEngine.prototype.post = function (host, message, notice, done) {
  var self = this;
  var campaign = self.campaign = host.campaign;
  var client = self.client = host.client;
  var infringements = self.infringements = host.infringements;

  var matchForm = WebFormEngine.selectForm(host);
  if (matchForm === null) {
    var err = new Error('Could not select a form for host: ' + host);
    done(err);
    return;
  }

  var infoObj = {
    campaignName: campaign.name,
    campaignURL: campaign.metadata.url,
    clientAuthorization: campaign.noticeInfo.authorization,
    clientName: client.name,
    contentMediaType: campaign.type,
    copyrightHolderFullName: client.name,
    infringingURLS: (infringements.length > 1) ? infringements.reduce(function (a, b) { return a.uri + '\n' + b.uri; }) : infringements[0].uri,
    MMDDYYYY: Date.create().format('{mm}/{dd}/{yyyy}')
  };

  self.executeForm(matchForm, infoObj).then(function () { return notice; }).nodeify(done);
}

WebFormEngine.canHandleHost = function (host) {
  return !!WebFormEngine.selectForm(host);
}

if (require.main === module) {
  var engine = new WebFormEngine();

  console.log('engine ready');
  var info = {
    copyrightHolderFullName: 'Mr Happy',
    infringingURLS: 'http://test1.com/thesmurfsgomentalandkillsomedudes.avi\nhttp://test2.com/StarWars7-thereturnofspock.mkv\nhttp://ilike.com/custarcreams.mp3\n',
    contentDescription: 'testing description',
    contentName: 'Mr Blobbys Xmas Single',
    contentMediaType: 'audio',
    MMDDYYYY: Date.create().format('{mm}/{dd}/{yyyy}')
  }

  engine.executeForm(resource.forms.gBloggerForm, info).then(function () {
    console.log('done submitting form?');
  }).fail(function (err) {
    logger.error('Error in promise chain: ', err);
    //console.log('failed: ', err);
  })
}