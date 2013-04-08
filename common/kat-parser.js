require('sugar');
var acquire = require('acquire')
  , Spidered = acquire('spidered').Spidered 
  , cheerio = require('cheerio')
  , logger = acquire('logger').forFile('kat-parser.js')
  , URI = require('URIjs')  
  , SpideredStates = acquire('spidered').SpideredStates    
;

var KatParser = module.exports;
var KAT_ROOT = 'http://www.katproxy.com';

/*
 * @param  {string}   source   The source of the given page
 * @return {array}             Populated or not with instances of Spidereds.
 */
KatParser.resultsPage = function(source, releaseDate){

  var links = [];
  var $ = cheerio.load(source);

  function testAttr($$, attrK, test){
    return $$(this).attr(attrK) && $$(this).attr(attrK).match(test);
  }

  $('tr').each(function(){
    var magnet = null;
    var fileLink = null;
    var torrentName = null;
    var size = null;
    var entityLink = null;
    var roughDate = null;
    var relevant = true;

    if(testAttr.call(this, $, 'id', /torrent_*/)){
      $(this).find('a').each(function(){
        if(testAttr.call(this, $, 'title', /Torrent magnet link/))
          magnet = $(this).attr('href');
        if(testAttr.call(this, $, 'title', /Download torrent file/))
          fileLink = $(this).attr('href');
        // TODO there are other types which i have yet to capture - 1 in 50 or so fails.
        if(testAttr.call(this, $, 'class', /^torType (undefined|movie|film|music)Type$/)){
          try{
            var inst = URI($(this).attr('href'));
            entityLink = inst.absoluteTo(KAT_ROOT).toString();
            logger.info('entityLink ' + entityLink + ' Kat root ' + KAT_ROOT);

          }
          catch(err){
            logger.warn('failed to create valid entity link : ' + err);
          }
        }
        if(testAttr.call(this, $, 'class', 'normalgrey font12px plain bold'))
          torrentName = $(this).text();
      });
      // grab the size and figure out the date.
      $(this).find('td').each(function(){
        if(testAttr.call(this, $, 'class', 'nobr center')){
          size = $(this).text();
          var age = $(this).next().next().text().trim();
          var context = {'Minutes': age.match(/min\./),
                         'Hours': age.match(/hour(s)?/),
                         'Days': age.match(/day(s)?/),
                         'Weeks': age.match(/week(s)?/),
                         'Months': age.match(/month(s)?/),
                         'Years': age.match(/year(s)?/)};
          var offsetLiteral;
          // its gotta be one and only one !            
          Object.keys(context).each(function(key){ if(context[key] !== null) offsetLiteral = key ;});
          var offset;
          age.words(function(word){
            if(parseInt(word)) 
              offset = word;
          })            
          roughDate = Date.create()['add' + offsetLiteral](-offset);
          if(releaseDate){
            var relDate = Date.create(releaseDate);
            relDate.addWeeks(-2);
            relevant = relDate.isBefore(roughDate);
          }
        }
      });

      if(magnet && entityLink && torrentName && relevant){
        
        var torrent =  new Spidered('torrent',
                                     torrentName,
                                     null,
                                     entityLink,
                                     SpideredStates.ENTITY_PAGE_PARSING);              
        torrent.magnet = magnet;
        torrent.fileSize = size;
        torrent.date = roughDate;
        torrent.directLink = fileLink; // direct link to torrent via querying torcache
        links.push(torrent);
        console.log('just created : ' + JSON.stringify(torrent));
      }
      else{
        logger.warn('fail to create : ' + JSON.stringify({magnet: magnet,
                                                          fileSize: size,
                                                          date: roughDate,
                                                          file: fileLink,
                                                          name: torrentName,
                                                          link: entityLink}));
      }
    }
  });  
  return links;  
}

/*
 * @param  {string}   source   The source of the given page
 * @return {dictionary}        With keys 'currentPage' (null or int)  and 'otherPages' (an array).
 */
KatParser.paginationDetails = function(source){
  var $ = cheerio.load(source);
  var result = {currentPage: null, otherPages: []};
  $('div.pages').children('a').each(function(){
    if($(this).attr('class').has('active')){
      result.currentPage = parseInt($(this).text());
    }
    else if($(this).attr('class').has('turnoverButton')){
      result.otherPages.push(parseInt($(this).text()));      
    }
  });
  return result;
}

/*
 * Scrape the hash ID and any file data from the torrent page.
 * @param  {string}     source   The source of the given page
 * @param {Spidered}   torrent  Instance of Spidered
 */
KatParser.torrentPage = function(source, torrent){
  var $ = cheerio.load(source);
  var haveFiles = false;
  // do you need to iterate - cheerio lookup API is a bit odd or maybe it's just me.
  $('table.torrentFileList tr').each(function(){
    if($('td').hasClass('torFileName') && !haveFiles){
      //TODO: split string on known file extensions.
      torrent.fileData.push($('td.torFileName').text().trim().humanize());
      haveFiles = true;
    }
  });
  $('span').each(function(){
    if($(this).attr('class') && $(this).attr('class') === 'lightgrey font10px'){
      var tmp = $(this).html().trim();
      torrent.hash_ID = 'torrent://' + tmp.split(': ')[1]; 
    }      
  });
}
