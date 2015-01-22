var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , fs = require('fs')
  , logger = acquire('logger')
  , sugar = require('sugar')
  , utilities = acquire('utilities')
  ;

var Infringements = acquire('infringements')
  , Seq = require('seq')
  ;

if (process.argv.length != 4) {
	console.warn('Call like: node ./add-verified-links-from-google.js CAMPAIGN_JSON FILE_CONTAINING_LINKS');
	console.warn('i.e. node ./add-verified-links-from-google.js ./campaign-foo.json ./verified-links');
	console.warn('File containing links should just be individual links seperated by newline chars');
	process.exit();
}

var argv = process.argv
  , campaign = require(argv[2])
  , file = fs.readFileSync(argv[3], { encoding: 'UTF-8' })
  , links = file.split('\n')
  , points = { score: 50, source:'manual' }
  , metadata = {}
  ;

infringements = new Infringements();
database.connectAndEnsureCollection('infringements', function(err, db, infringements_) {

	Seq(links)	  
	  // Make sure all infringements exist
	  .seqEach(function(uri) {
	  	var that = this;
	  	infringements.add(campaign, uri, campaign.type, 'searchengine.google', -1, points, metadata, function(err) {
	  		if (err) return that(err);

        //verify(infringements_, uri, that);
        //return;

	  		infringements.addMeta(campaign, uri, campaign.type, 'searchengine.google', -1, metadata, function(err) {
	  			if (err) return that(err);

	  			verify(infringements_, uri, that);
	  		});
	  	});
	  })
	  .catch(function(err) {
			console.warn(err);
		})
		;
});

function verify(infringements_, uri, done) {
	console.log('verifying: ', uri);
	var updates = {
		$set: {
			state: 1,
			verified: Date.now()
		}
	};

	infringements_.update({ uri: utilities.normalizeURI(uri), verified: { $exists: false } }, updates, done);
}