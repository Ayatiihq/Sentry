/*
 * cyberlockers.js: a flat list of the domains of known cyberlockers
 * 
 * (C) 2013 Ayatii Limited
 *
 */

var CyberLockers = module.exports;

CyberLockers.knownDomains = [
  '100shared.com',
  '180upload.com',
  '1fichier.com',
  '247upload.com',
  '2shared.com',
  '4shared.com',
  '4sync.com',
  'adrive.com',
  'albafile.com',
  'arabloads.com',
  'asuswebstorage.com',
  'banashare.com',
  'basicupload.com',
  'bayfiles.com',
  'billionuploads.com',
  'bitshare.com',
  'box.com',
  'carrier.so',
  'cloudsafe.com',
  'cloudzer.net',
  'cloudzer.net',
  'cramit.in',
  'crocko.com',
  'cyberlocker.org',
  'depositfiles.com',
  'drawpr.com',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'dxr.lanedo.com',
  'easybytez.com',
  'ex.ua',
  'expressleech.com',
  'extabit.com',
  'fast-file.com',
  'fiberupload.net',
  'file4safe.com',
  'file4sharing.com',
  'fileband.com',
  'filecatalyst.com',
  'filechum.com',
  'filecloud.io',
  'fileconvoy.com',
  'filecopter.net',
  'filedefend.com',
  'fileden.com',
  'filefactory.com',
  'fileflyer.com',
  'filegag.com',
  'filekom.com',
  'filemates.com',
  'filenuke.com',
  'filepost.com',
  'fileprohost.com',
  'filerio.com',
  'files.com',
  'filesanywhere.com',
  'filesega.com',
  'filesfrom.com',
  'fileshare.in.ua',
  'filesin.com',
  'fileslap.com',
  'fileslap.com',
  'filesmonster.com',
  'filesnack.com',
  'filesocial.com',
  'filestay.com',
  'fileswap.com',
  'filevelocity.com',
  'firstclass-download.com',
  'foldier.com',
  'freakshare.com',
  'free4udown.com',
  'freestorage.ro',
  'fuupload.com',
  'gamefront.com',
  'ge.tt',
  'gigasize.com',
  'gigaup.fr',
  'globusonline.org',
  'hellshare.com',
  'hipfile.com',
  'hostingbulk.com',
  'hotfile.com',
  'hulkfile.eu',
  'hulkshare.com',
  'icloud.com',
  'ifile.ws',
  'itsuploaded.com',
  'jumbofiles.com',
  'letitbit.net',
  'limelinx.com',
  'livedrive.com',
  'loadpot.net',
  'luckyshare.net',
  'lumfile.com',
  'magicvortex.com',
  'mediafire.com',
  'mega.co.nz',
  'megaload.it',
  'megashares.com',
  'midupload.com',
  'mixturecloud.com',
  'movshare.net',
  'movreel.com',
  'movzap.com',
  'mozy.com',
  'muchshare.net',
  'multiup.org',
  'multiupload.nl',
  'novafile.com',
  'novamov.com',
  'nowdownload.eu',
  'nowvideo.eu',
  'obligao.com',
  'oteupload.com',
  'peejeshare.com',
  'pigsonic.com',
  'putlocker.com',
  'queenshare.com',
  'rapidgator.net',
  'rapidshare.com',
  'restfile.ca',
  'ryushare.com',
  'saarie.com',
  'secureupload.eu',
  'sendmyway.com',
  'sendspace.com',
  'senduit.com',
  'share-online.biz',
  'sharebeast.com',
  'sharefiles.co',
  'shareflare.net',
  'sharesend.com',
  'skydrive.live.com',
  'slingfile.com',
  'sockshare.com',
  'speedyshare.com',
  'spideroak.com',
  'streamcloud.org',
  'sugarsync.com',
  'syncblaze.com',
  'syncblazecloud.vembu.com',
  'syncplicity.com',
  'turbobit.net',
  'tusfiles.net',
  'twindocs.com',
  'ubuntuone.com',
  'ul.to',
  'uloz.to',
  'ultramegabit.com',
  'unlimitedshare.com',
  'upafile.com',
  'upload.ee',
  'uploadbaz.com',
  'uploadcare.com',
  'uploaded.net',
  'uploadhero.co',
  'uploadic.com',
  'uploading.com',
  'uploadingit.com',
  'uploadorb.com',
  'uptobox.com',
  'usaupload.net',
  'verzend.be',
  'videobam.com',
  'videoweed.es',
  'vidto.me',
  'vip-file.com',
  'vreer.com',
  'wikisend.com',
  'wuala.com',
  'xenubox.com',
  'yandex.com',
  'yousendit.com',
  'ziddu.com',
  'zippyshare.com',
  'zomgupload.com',
  'zuzvideo.com'
];

CyberLockers.idMatchers = {

  'hostingbulk.com': {
    domain: 'hostingbulk.com',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{12}/);
      return id ? id[0] : null;
    }
  },

  'movshare.net': {
    domain: 'movshare.net',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{13}/);
      return id ? id[0] : null;
    }
  },

  'movzap.com': {
    domain: 'movzap.com',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{12}/);
      return id ? id[0] : null;
    }
  },

  'novamov.com': {
    domain: 'novamov.com',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{13}/);
      return id ? id[0] : null;
    }
  },

  'nowvideo.eu': {
    domain: 'nowvideo.eu',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{13}/);
      return id ? id[0] : null;
    }
  },


  'vidto.me': {
    domain: 'vidto.me',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{12}/);
      return id ? id[0] : null;
    }
  },

  'videoweed.es': {
    domain: 'videoweed.es',
    getId: function(uri) {
      var id = uri.match(/[a-zA-Z0-9]{13}/);
      return id ? id[0] : null;
    }
  }

};