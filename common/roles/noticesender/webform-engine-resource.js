"use strict"
require('sugar');
var Q = require('q');

// this could of been a json file but json is a bit too restrictive so fuck it - its not a json file
// constants

var constants = exports.constants = {
  ayatiiCompanyName: 'Ayatii Limited',
  ayatiiEmail: 'neilpatel@ayatii.com',
  ayatiiFullName: 'Neil Patel',
  ayatiiFirstName: 'Neil',
  ayatiiLastName: 'Patel',
  ayatiiTele: '+44 (0) 208 133 2192',
  ayatiiAddress: 'Kemp House, 152-160 City Road',
  ayatiiCity: 'London',
  ayatiiState: 'London',
  ayatiiPostcode: 'EC1V 2NX',
  ayatiiCountry: 'UK',
  ayatiiDescription: "The original works are copyrighted works of ${clientName} specifically the '${campaignName}' work. Pursuant to 17 USC § 512(c)(3)(A)(ii)\n\
the website for the media is located at ${campaignURL} . We are the authorized agents of ${clientName}, our authorization document is available at ${clientAuthorization}"
}


// move this into json files maybe? 

// basic system that uses logic expressed in a data structure to fill out our forms.
// basically, url is the url of the form, submit is a selector to the submit button
// formText is an object that contains a bunch of selectors as keys with text to fill out
// text with ${foo} style will be replaced like Logger.dictFormat
// formCheckBoxes is an object containing a bunch of selectors as keys with checkboxes to check
var cloudFlareForm = {
  dynamicMatcher: function(host) { 
  var basicExpression = /cloudflare/ig;
  var accumulator = false;
  accumulator |= basicExpression.test(host.hostedBy);
  accumulator |= basicExpression.test(host.name);
  accumulator |= basicExpression.test(host._id);
  accumulator |= /cloudflare\.com/ig.test(host.uri);
  return accumulator;
  },
  url: 'https://www.cloudflare.com/abuse/form',
  waitforSelector: 'select#form-select',
  preActions: {
  'click': 'option[value=dmca]'
  },
  submit: 'input#abuse-submit',
  formText: {
  'input#Name': '${ayatiiFullName}',
  'input#HolderName': '${copyrightHolderFullName}',
  'input#Email': '${ayatiiEmail}',
  'input#EmailConfirm': '${ayatiiEmail}',
  'input#Title': 'Mr',
  'input#Company': 'Ayatii',
  'input#Tele': '${ayatiiTele}',
  'input#Address': '${ayatiiAddress}',
  'input#City': '${ayatiiCity}',
  'input#State': '${ayatiiState}',
  'textarea#URLs': '${infringingURLS}',
  'textarea#OriginalWork': constants.ayatiiDescription,
  'input#Signature': '${ayatiiFullName}'
  },
  formCheckBoxes: {
  'input#Agree': true
  },
  actions: {
  'click': 'option[value=GB]'
  }
};

var bingForm = {
  dynamicMatcher: function (host) { return /bing/gi.test(host.name); },
  url: 'https://www.microsoft.com/info/FormForSearch.aspx',
  submit: 'INPUT#ctl00_ContentPlaceHolder1_Btn_Submit',

  formText: {
  'INPUT#ctl00_ContentPlaceHolder1_fname': '${ayatiiFirstName}',
  'INPUT#ctl00_ContentPlaceHolder1_lname': '${ayatiiLastName}',
  'INPUT#ctl00_ContentPlaceHolder1_email': '${ayatiiEmail}',
  'INPUT#ctl00_ContentPlaceHolder1_companyName': '${copyrightHolderFullName}',
  'INPUT#ctl00_ContentPlaceHolder1_country': '${ayatiiCountry}',
  'INPUT#ctl00_ContentPlaceHolder1_titleOfWork': '${campaignName}',
  'INPUT#ctl00_ContentPlaceHolder1_TypeOfWork': '${contentMediaType}',
  'INPUT#ctl00_ContentPlaceHolder1_url': '${clientAuthorization}',
  'TEXTAREA#ctl00_ContentPlaceHolder1_urlInfringed': '${infringingURLS}',
  'TEXTAREA#ctl00_ContentPlaceHolder1_additionalInfo': constants.ayatiiDescription,
  'INPUT#ctl00_ContentPlaceHolder1_signature': '${ayatiiFullName}'
  },

  formCheckBoxes: {
  'INPUT#GoodFaithBelief': true,
  'INPUT#AuthorityToAct': true,
  'INPUT#Acknowledgement': true
  },

};

var dailyMotionForm = {
  dynamicMatcher: function (host) { return /dailymotion/gi.test(host.name); },
  url: 'http://www.dailymotion.com/feedback/copyright/notification',

  actions: {
    'click': 'option[value=legal]'
  },

  formText: {
    'INPUT#form_copyright_notification_lastname': '${ayatiiLastName}',
    'INPUT#form_copyright_notification_firstname': '${ayatiiFirstName}',
    'INPUT#form_copyright_notification_address': '${ayatiiAddress}, ${ayatiiPostcode}, ${ayatiiCountry}',
    'INPUT#form_copyright_notification_email': '${ayatiiEmail}',
    'INPUT#form_copyright_notification_phone': '${ayatiiTele}',
    'TEXTAREA#form_copyright_notification_videos': '${infringingURLS}',
    'TEXTAREA#form_copyright_notification_reasons': constants.ayatiiDescription
  },

  formCheckBoxes: {
    'INPUT#form_copyright_notification_termsofuse': true,
    'INPUT#form_copyright_notification_info': true
  },

  submit: 'INPUT#form_copyright_notification_save'
}

var gBloggerForm = {
  dynamicMatcher: function (host) { return /blogger/gi.test(host.name); },
  url: 'https://support.google.com/legal/contact/lr_dmca?product=blogger',

  specificOverride: function (info) {
    var self = this; // self gets bound to the WebFormEngine object
    var deferred = Q.defer();

    var infringementURLs = info.infringingURLS;
    
    // this is dumb, but gets a list of all the names of all the input boxes
    var getAllInputIDs = function () { 
      var inputIDs = [];
      var inputDeferred = Q.defer();
      self.browser.getDriver().findElements({'css': 'INPUT'}).then(function (elements) {
        var lastPromise = null;
        elements.each(function (element) { 
          lastPromise = element.getAttribute('id').then(function (value) { inputIDs.push(value); });
        });
        lastPromise.then(function () { inputDeferred.resolve(inputIDs); });
      });
      return inputDeferred.promise;
    }


    getAllInputIDs().then(function (previousInputIDs) {
      // we need to click on the add url button like a billion times or maybe once
      var lastClick = null;
      if (infringementURLs.length > 1) {
        for (var i = 0; i < infringementURLs.length; i++) { 
          lastClick = self.browser.click('A.add-additional');
        }
      }

      // once we clicked on the url button a billion times or whatever, find all the new input boxes that showed up
      lastClick.then(function () { 
        getAllInputIDs().then(function (newInputIDs) { 
          var inputIDResult = previousInputIDs.exclude.apply(previousInputIDs, newInputIDs);
          // christ after all that, we should have an array of input ids
        });
      });
    });
    



    return deferred.promise;
  }
}


exports.forms = {
  'cloudflare': cloudFlareForm,
  'bing': bingForm
};