/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master talks to the Hub, making sure things are in sync and using the hub
 * to launch the right roles depending on what the system requires.
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , config = acquire('config')
  , events = require('events')
  , io = require('socket.io-client')
  , logger = acquire('logger').forFile('master.js')
  , os = require('os')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Master = module.exports = function() {
  this.nodeState_ = states.node.state.RUNNING;
  this.hubState_ = states.hub.state.PAUSED;
  this.version_ = null;
  
  this.hub_ = null;
  this.connected_ = false;

  this.nPossibleWorkers_ = 0;

  this.mainInterval_ = 0;

  this.init();
}

util.inherits(Master, events.EventEmitter);

Master.prototype.init = function() {
  var self = this;

  self.nPossibleWorkers_ = self.getPossibleWorkers();

  utilities.getVersion(function(version) {
    self.version_ = version;
    self.initHubConnection();
  });

  self.mainInterval_ = setInterval(self.loop.bind(self), 1000 * 60);

  cluster.on('exit', self.onWorkerExit.bind(self));
}

Master.prototype.getPossibleWorkers = function() {
  var possible = os.totalmem() - 104857600; // 100 MB for os
  possible /= 104857600 // 100 MB per worker max
  possible = Math.round(possible);

  return Math.min(possible, config.MAX_WORKERS);
}

Master.prototype.initHubConnection = function() {
  var self = this;

  self.hub_ = io.connect(config.HUB_ADDRESS + '/node', { port: config.HUB_PORT, secure: true });
  self.hub_.on('connect', self.onConnection.bind(self));
  self.hub_.on('disconnect', self.onDisconnection.bind(self));
  self.hub_.on('error', self.onError.bind(self));
  self.hub_.on('stateChanged', self.onHubStateChanged.bind(self));
}

Master.prototype.newMessage = function() {
  return { secret: config.HUB_SECRET };
}

Master.prototype.onConnection = function() {
  var self = this;

  logger.info('Connected to Hub, handshaking');

  self.hub_.emit('handshake', self.newMessage(), function(reply) {
    console.log(reply.version, self.version_);
    if (reply && reply.version && reply.version.revision == self.version_.revision) {
      logger.info('Handshake successful');
      self.connected_ = true;
      self.onHubStateChanged(reply.state);
      self.announce();

    } else {
      logger.warn('Handshake unsuccessful, exiting for update');
      logger.warn(reply)
      logger.warn(self.version_)
      self.nodeState_ = states.node.state.NEEDS_UPDATE;
      self.announce();
    }

    self.loop();
  });
}

Master.prototype.onDisconnection = function() {
  var self = this;

  logger.warn('Disconnected from Hub');
  self.connected_ = false;
}

Master.prototype.onError = function(err) {
  var self = this;

  logger.warn(err);
  
  logger.info('Trying a reconnect in 60 seconds');
  setTimeout(self.initHubConnection.bind(self), 1000 * 60);
}

Master.prototype.onHubStateChanged = function(state) {
  var self = this;

  logger.info('Hub state changed to', state);
  self.hubState_ = state;

  self.loop();
}

Master.prototype.announce = function() {
  var self = this
    , msg = self.newMessage()
    ;

  msg.state = self.nodeState_;
  msg.version = self.version_;
  msg.capacity = self.nPossibleWorkers_;
  msg.usage = Object.size(cluster.workers);

  self.hub_.emit('announce', msg);
}

Master.prototype.loop = function() {
  var self = this
    , hubStates = states.hub.state
    , nodeStates = states.node.state
    , workerCount = Object.size(cluster.workers)
    ;

  // If we need an update and no workers are working, let's exit for update
  if (self.nodeState_ === nodeStates.NEEDS_UPDATE) {
    if (workerCount < 1) {
      logger.info('Going down for update');
      process.exit(0);
    }
    return;
  }

  // Updating pausing/paused
  if (self.nodeState_ === nodeStates.PAUSING && workerCount < 1) {
    self.nodeState_ = nodeStates.PAUSED;
    self.announce();
    logger.info('All jobs have finished, node is paused.');
  }

  // If we're not connected, or the hub/node is pausing/paused, don't do anything
  if (!self.connected_ ||
      self.hubState_ === hubStates.PAUSING ||
      self.hubState_ === hubStates.PAUSED ||
      self.hubState_ === hubStates.NEEDS_UPDATE ||
      self.nodeState_ === nodeStates.PAUSING ||
      self.nodeState_ === nodeStates.PAUSED) {
    logger.info('Hub/Node not ready');
    return;
  }

  if (workerCount >= self.nPossibleWorkers_) {
    logger.info('No available workers');
    return;
  }

  // Ran the gauntlet, time to ask the hub to give us some work!
  for (var i = workerCount; i <= self.nPossibleWorkers_; i++)
    self.getSomeWork();
}

Master.prototype.getSomeWork = function() {
  var self = this
    , msg = self.newMessage()
    ;

  // Stagger requests for work
  setTimeout(function() {

    // FIXME: Normally msg would contain any limitations of this node
    // such as which roles it can execute, we don't support that
    // right now as all nodes are equal.
    logger.info('Asking Hub for some work to do');
    self.hub_.emit('getWork', msg, function(work) {
      if (!work) {
        logger.info('Hub has no work to do');
        return;
      }

      if (Object.size(cluster.workers) >= self.nPossibleWorkers_) {
        logger.info('No available workers');
        return;
      }

      logger.info('Got some work', JSON.stringify(work));
      self.launchWorker(work);
    });
  }, 1000 * 20 * Math.random());
}

Master.prototype.launchWorker = function(work) {
  var self = this
    , worker = cluster.fork()
    ;

  worker.work = work;
  worker.on('message', self.onWorkerMessage.bind(self, worker));
  worker.killId = 0;

  worker.send({ type: 'doWork', work: work });

  logger.info('Created worker %s: %s ', worker.id, JSON.stringify(work));

  self.announce();
}

Master.prototype.onWorkerMessage = function(worker, message) {
  var self = this;

  logger.warn('Unknown worker message');
}

Master.prototype.onWorkerExit = function(worker, code, signal) {
  var self = this;

  if (worker.suicide === true) {
    logger.info('Worker %s finished doing work', worker.id);
  } else {
    logger.warn('Worker %s died unexpectedly: code=%s signal=%s', worker.id, code, signal);
  }
}