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

// move this into json files maybe? 

// basic system that uses logic expressed in a data structure to fill out our forms.
// basically, url is the url of the form, submit is a selector to the submit button
// formText is an object that contains a bunch of selectors as keys with text to fill out
// text with ${foo} style will be replaced like Logger.dictFormat
// formCheckBoxes is an object containing a bunch of selectors as keys with checkboxes to check
var cloudFlareForm = {
  url: 'https://www.cloudflare.com/abuse/form',
  waitforSelector: 'select#form-select',
  preActions: {
    'click':'option[value=dmca]'
  },

  submit: 'input#abuse-submit',
  formText: {
    'input#Name': '${ayatiiFullName}',
    'input#HolderName': '${CopyrightHolderFullName}',
    'input#Email': '${ayatiiEmail}',
    'input#EmailConfirm': '${ayatiiEmail}',
    'input#Title': 'Mr',
    'input#Company': 'Ayatii',
    'input#Tele': '${ayatiiTele}',
    'input#Address': '${ayatiiAddress}',
    'input#City': '${ayatiiCity}',
    'input#State': '${ayatiiState}',
    'textarea#URLs': '${infringingURLS}',
    'textarea#OriginalWork': '${contentDescription}',
    'input#Signature': '${ayatiiFullName}'
  },
  formCheckBoxes: {
    'input#Agree': true
  },
  formComboBoxes: {
    'select#Country': '${ayatiiCountry}'
  }
}


// constants
var Constants = {
  ayatiiCompanyName: 'Ayatii Limited',
  ayatiiEmail: 'neilpatel@ayatii.,com',
  ayatiiFullName: 'Neil Patel',
  ayatiiTele: '+44 (0) 208 133 2192',
  ayatiiAddress: 'Kemp House, 152-160 City Road',
  ayatiiCity: 'London',
  ayatiiState: 'London',
  ayatiiPostcode: 'EC1V 2NX',
  ayatiiCountry: 'UK'
}

// very simple wrapper around our browser calls, so we can replace with cow at some point
var BrowserEngine = function () {
  var self = this;
  events.EventEmitter.call(self);

  self.driver = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                             .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' })
                             .build();

}
util.inherits(BrowserEngine, events.EventEmitter);

// if selectorToWaitFor is returned, will wait for that selector to be true before resolving
BrowserEngine.prototype.gotoURL = function (url, selectorToWaitFor) {
  var self = this;
  var deferred = new Q.defer();

  var seleniumPromise = self.driver.get(url);
  //self.debugScreenshot('/media/storage/projects/forks/sentry/initial.png');

  if (selectorToWaitFor !== undefined) {
  //  var selector = webdriver.By.css(selectorToWaitFor);
  //  seleniumPromise = seleniumPromise.then(self.driver.findElement.bind(self.driver, selector));
  }

  seleniumPromise.then(deferred.resolve, deferred.reject);
  return deferred.promise.delay(5000); // delay 5 seconds to allow it to load
}

BrowserEngine.prototype.sleep = function (timeout) {
  return Q.delay(timeout);
}

BrowserEngine.prototype.fillTextBox = function (selector, text) {
  var self = this;
  var deferred = new Q.defer();

  logger.info('fillTextBox(%s, %s)', selector, text);

  self.driver.findElement(webdriver.By.css(selector)).sendKeys(text).then(deferred.resolve, deferred.reject);

  return deferred.promise;
}

BrowserEngine.prototype.checkBox = function (selector) {
  var self = this;
  var deferred = new Q.defer();
  logger.info('selector(%s)', selector);
  self.driver.findElement(webdriver.By.css(selector)).click().then(deferred.resolve, deferred.reject);

  return deferred.promise;
}

BrowserEngine.prototype.submit = function (selector) {
  var self = this;
  logger.error('omgwtfbbq not ready for this jelly');
  throw new Error('bad :(');
  return self.click(selector);
}

BrowserEngine.prototype.click = function (selector) {
  var self = this;
  var deferred = new Q.defer();

  self.driver.findElement(webdriver.By.css(selector)).click().then(deferred.resolve, deferred.reject);

  return deferred.promise;
}

BrowserEngine.prototype.comboBox = function (selector, selection) {
  var self = this;
  var deferred = new Q.defer();
  logger.info('comboBox(%s, %s)', selector, selection);
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

WebFormEngine.prototype.executeForm = function (formTemplate, info) {
  var self = this;
  var deferred = Q.defer();

  var combinedInfo = Object.merge(Constants, info);

  // this would be so much nicer with generators.. 
  self.browser.gotoURL(formTemplate.url, formTemplate.waitforSelector).then(function () {
    var preCommands = [];
    // first we allow a few pre actions to complete 
    Object.each(formTemplate.preActions, function preActions(action, selector) {
      switch (action) {
        case 'click':
          preCommands.push(self.browser.click.bind(self.browser, selector));
          break;
        default:
          logger.error('got a weird action: %s(%s)', action, selector);
          break;
      }
    });

    // laaaame, generators plz.
    // okay so i figured this might be a bit complicated to look at, but its simple honest
    // preCommands will be either empty or contain an array of promise returning functions, calling .reduce(Q.when, Q())
    // will basically execute each function one after the other waiting for each promise to return before calling the next one
    // then once its done we delay(5000) because of lazyness before doing essentially the same thing with the commands array

    return preCommands.reduce(Q.when, Q()).delay(5000).then(function () {
      var commands = []; // array of promises 
      // create all the text filling commands
      logger.info('filling out the form');
      Object.each(formTemplate.formText, function addTextToForm(selector, text) {
        text = acquire('logger').dictFormat(text, combinedInfo);
        commands.push(self.browser.fillTextBox.bind(self.browser, selector, text));
      });

      // same with checkboxes, check any that are in our selectors
      Object.each(formTemplate.formCheckBoxes, function checkBoxes(selector) {
        commands.push(self.browser.checkBox.bind(self.browser, selector));
      });

      // same with combo boxes, change the selection to whatever selection is, does by text not selector
      Object.each(formTemplate.formComboBoxes, function comboSelectors(selector, selection) {
        selection = acquire('logger').dictFormat(selection, combinedInfo);
        commands.push(self.browser.comboBox.bind(self.browser, selector, selection));
      });

      // executes all our commands as a sequence, selenium does not need this, but cow will i believe
      logger.info('got %s commands to execute', commands.length);
      return commands.reduce(Q.when, Q()).then(function () { logger.info('finished commands'); self.browser.debugScreenshot('shouldnotgetthisfar.png'); });
    });

  }).then(function () {
    logger.info('finished filling out form');
    self.browser.debugScreenshot('finishedform.png');
    //else { return self.browser.submit(formTemplate.submit) };
  }).then(function () {
    deferred.resolve();
    self.browser.quit();
  }).fail(function (err) {
    logger.error(err);
    self.browser.debugScreenshot('debug.png').then(self.browser.quit.bind(self.browser));
  });

  return deferred.promise;
}

WebFormEngine.prototype.post = function (host, message, notice, done) {
}

if (require.main === module) {
  fs.writeFileSync('/media/storage/projects/forks/sentry/foo.txt', 'hello world');

  var engine = new WebFormEngine();

  console.log('engine ready');
  var info = {
    copyrightHolderFullName: 'Mr Happy',
    infingingURLS: 'test1\n test2\n test3\n',
    contentDescription: 'testing description'
  }

  engine.executeForm(cloudFlareForm, info).then(function () {
    console.log('done submitting form?');
  }).fail(function (err) {
    console.log('failed: ' + err);
  })
}