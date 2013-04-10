require('sugar');

var acquire = require('acquire')
  , TorrentDescriptor = acquire('spidered').TorrentDescriptor 
  , SpideredStates = acquire('spidered').SpideredStates    
  , cheerio = require('cheerio')
  , logger = acquire('logger').forFile('isohunt-parser.js')
  , URI = require('URIjs')  
;

var IsoHuntParser = module.exports;
var ISOHUNT_ROOT = 'http://www.isohunt.com';

/*
 * Scrape the results page and create TorrentDescriptor instance per result
 * @param  {string}   source   The source of the given page
 * @return {array}             Populated with instances of Spidereds.
 */
IsoHuntParser.resultsPage = function(source, campaign){
  var links = [];
  var $ = cheerio.load(source);

  function testAttr($$, attrK, test){
    return $$(this).attr(attrK) && $$(this).attr(attrK).match(test);
  }

  function makeRoughDate(age){
    var context = {'Weeks': age.match(/w/),
                   'Hours': age.match(/h/),
                   'Days': age.match(/d/)};
    var offsetLiteral;
    // its gotta be one and only one !            
    Object.keys(context).each(function(key){ if(context[key] !== null) offsetLiteral = key ;});
    var offset;
    age.replace(/[w|h|d]/, '');
    offset = parseFloat(age);
    return Date.create()['add' + offsetLiteral](-offset);
  }
	var torrentName = null;
	var entityLink = null;;
	var roughDate = null;

	$("td").each(function(){
		if(testAttr.call(this, $, 'id', /row_[0-9]_[0-9]+/)){
			roughDate = makeRoughDate($(this).text());
		}
		if(testAttr.call(this, $, 'class', /row3/) &&
			testAttr.call(this, $, 'id', /name[0-9]+/)){			
			$(this).find('a').each(function(){
				if(testAttr.call(this, $, 'id', /link[0-9]+/)){
					try{
						var path = URI($(this).attr('href'));
						entityLink = path.absoluteTo(ISOHUNT_ROOT).toString();
					}
					catch(err){
						logger.warn("Unable to create an EntityLink");
					}
					torrentName = $(this).text();
				}
			});
		}
		if(torrentName && entityLink && roughDate){
        var torrent =  new TorrentDescriptor(torrentName,
                                             campaign.type,
                                             entityLink);              
        torrent.date = roughDate;
        logger.info("Just created : " + JSON.stringify(torrent));
        links.push(torrent);			
				
				torrentName = null;
				entityLink = null;
				roughDate = null;
				age = null;
		}		
		else{
        /*logger.warn('fail to create : ' + JSON.stringify({date: roughDate,
                                                          name: torrentName,
                                                          link: entityLink}));*/
		}
	});
  return links;
}

/*
 * @param  {string}     source   The source of the given page
 * @return {dictionary}          With keys 'currentPage' (null or int)  and 'otherPages' (an array).
 */
IsoHuntParser.paginationDetails = function(source){
  var $ = cheerio.load(source);
  var numbers = [];
  results = {currentPage : null, otherPages: []};
  $("table.pager td u").text().words(function(word){
  	if(parseInt(word))
    	numbers.push(parseInt(word)); 
  });
	results.currentPage = numbers.min();
	results.otherPages.push(numbers.max());
  return results;
}


/*
 * Scrape the hash ID and any file data from the torrent page.
 * @param  {string}              source   The source of the given page
 * @param  {TorrentDescriptor}   torrent  Instance of Spidered
 */
IsoHuntParser.torrentPage = function(source, torrent){
}


