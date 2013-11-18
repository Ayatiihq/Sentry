"use strict"
// this could of been a json file but json is a bit too restrictive so fuck it its not a json file
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


exports.forms = {
  'cloudflare': cloudFlareForm,
  'searchengine.bing': bingForm
};