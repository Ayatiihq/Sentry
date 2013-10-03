/*
 * test_jobs.js: tests the jobswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Downloads = acquire('downloads')
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_downloads.js');

  setupSignals();

  var downloads = new Downloads();
  var action = argv[2];
  var arg0 = argv[3]

  if (action === 'getFileMimeType')
    Downloads.getFileMimeType(arg0, log);

  if (action === 'getInfringementDownloads')
    downloads.getInfringementDownloads(require(arg0), log);

  if (action === 'popForCampaign'){
    console.log('popForCampaign');
    var supportedMimeTypes_ = [ 'video/x-ms-asf'
                              , 'video/x-msvideo'
                              , 'video/x-flv'
                              , 'video/quicktime'
                              , 'video/mp4'
                              , 'video/mpeg'
                              , 'video/x-ms-wmv'
                              ];

    var options= {};
    options.mimetypes = supportedMimeTypes_;
    options.notProcessedBy = 'timeline-generator';

    downloads.popForCampaign(require(arg0), options, log);
  }
  
  if (action === 'processedBy'){
    var download = { _id: 'bb7ed3e1e4b8b29ac27100d1fcc7a8b034a61eaf',
                    campaign: { client: 'Viacom 18', campaign: 'Bhaag Milkha Bhaag' },
                    infringement: 'e33037a4d9f85bc1df1d642aa93847484dcc3387',
                    name: 'bb7ed3e1e4b8b29ac27100d1fcc7a8b034a61eaf',
                    origName: 'e5dc225bb456fc53842dcb6e5d6185067bc232c8',
                    mimetype: 'video/mp4',
                    size: 259572962,
                    created: 1376028240520,
                    started: 1376026456167,
                    finished: 1376028182107 };
    
    downloads.processedBy(download, 'timeline-generator', log);
  }
  
  if (action === 'addLocalDirectory')
    downloads.addLocalDirectory(require(argv[3]), argv[4], argv[5], argv[6], log);

  if (action === 'touch')
    downloads.touch({ _id: arg0 }, log);
}

main();