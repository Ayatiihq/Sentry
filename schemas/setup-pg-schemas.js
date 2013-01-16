/*
 * setup-schemas.js: sets up the Sentry schemas on a Postgres database
 *
 *  (C) 2012 Ayatii Limited
 *
 */

var seq = require('parseq').seq
  , pg = require('pg').native;

var connString = process.env.DATABASE_URL || "postgres://njpatel@localhost/njpatel";

var extensionsQuery = "CREATE EXTENSION hstore;";

var clientsTableQuery = 
"CREATE TABLE Clients (                          \
  id serial8 PRIMARY KEY,                        \
  name varchar(255) NOT NULL CHECK (name <> ''), \
  imageURL varchar(2000),                        \
  created timestamp DEFAULT current_timestamp    \
);";

var usersTableQuery = 
"CREATE TABLE Users (                                      \
  id serial8 PRIMARY KEY,                                  \
  client int8 REFERENCES clients(id),                      \
  created timestamp DEFAULT current_timestamp,             \
  firstname varchar(255) NOT NULL CHECK (firstname <> ''), \
  lastname varchar(255) NOT NULL CHECK (lastname <> ''),   \
  email varchar(255) NOT NULL CHECK (email <> ''),         \
  type int2 DEFAULT 0,                                     \
  properties hstore                                        \
);";

var campaignsTableQuery = 
"CREATE TABLE Campaigns (                             \
  id serial8 PRIMARY KEY,                             \
  client int8 REFERENCES clients(id),                 \
  name varchar(255) NOT NULL CHECK (name <> ''),      \
  description text,                                   \
  imageURL varchar(2000),                             \
  created timestamp DEFAULT current_timestamp,        \
  sweepEnabled bool DEFAULT false,                    \
  sweepFromDate timestamp DEFAULT current_timestamp,  \
  sweepToDate timestamp DEFAULT current_timestamp,    \
  sweepIntervalMinutes int2 DEFAULT 180,              \
  type varchar(255) NOT NULL CHECK (type <> ''), \
  names varchar(255)[],                               \
  properties hstore,                                  \
  scrapersEnabled varchar(255)[],                     \
  scrapersIgnored varchar(255)[]                      \
);";

var scraperJobsTableQuery = 
"CREATE TABLE ScraperJobs (                            \
  id serial8 PRIMARY KEY,                              \
  scraper varchar(255) NOT NULL CHECK (scraper <> ''), \
  campaign int8 REFERENCES campaigns(id),              \
  created timestamp DEFAULT current_timestamp,         \
  started timestamp DEFAULT current_timestamp,         \
  finished timestamp,                                  \
  state int2 DEFAULT 0,                                \
  properties hstore                                    \
);";

var urisTableQuery = 
"CREATE TABLE URIs (                             \
  id serial8 PRIMARY KEY,                        \
  campaign int8 REFERENCES campaigns(id),        \
  uri text NOT NULL CHECK (uri <> ''),           \
  type varchar(255) NOT NULL CHECK (type <> ''), \
  state int2 DEFAULT 0,                          \
  created timestamp DEFAULT current_timestamp,   \
  modified timestamp DEFAULT current_timestamp,  \
  properties hstore,                             \
  posted timestamp,                              \
  takenDown timestamp                            \
);";

var uriRelationsQuery =
"CREATE TABLE URIRelations (                  \
  id serial8 PRIMARY KEY,                     \
  source int8 REFERENCES uris(id) NOT NULL,   \
  target int8 REFERENCES uris(id) NOT NULL,   \
  created timestamp DEFAULT current_timestamp \
);";

var verificationsTableQuery = 
"CREATE TABLE Verifications (                  \
  id serial8 PRIMARY KEY,                      \
  uri int8 NOT NULL,                           \
  created timestamp DEFAULT current_timestamp, \
  source int2 DEFAULT 0,                       \
  who int8 REFERENCES users(id),               \
  started timestamp,                           \
  completed timestamp,                         \
  properties hstore                            \
)";

var downloadsTableQuery = 
"CREATE TABLE Downloads (                      \
  uri int8 REFERENCES uris(id) PRIMARY KEY,    \
  created timestamp DEFAULT current_timestamp, \
  state int2 DEFAULT 0,                        \
  location text,                               \
  timeTaken time,                              \
  properties hstore                            \
);";

var noticesTableQuery = 
"CREATE TABLE Notices (                        \
  id serial8 PRIMARY KEY,                      \
  uri int8 REFERENCES uris(id),                \
  created timestamp DEFAULT current_timestamp, \
  expires timestamp,                           \
  type int2 DEFAULT 0,                         \
  method int2 DEFAULT 0,                       \
  properties hstore                            \
);";

function pgReply(client, err, result) {
  this(err, client);
}

function main() {
  console.log('Creating schemas on ' + connString);

  seq(
    function connect() {
      var self = this;
      pg.connect(connString, function(err, client) {
        self(err, client);
      });
    },

    function loadExtensions(err, client) {
      var self = this;
      client.query(extensionsQuery, pgReply.bind(this, client));
    },
    
    function clientsTable(err, client) {
      var self = this;
      client.query(clientsTableQuery, pgReply.bind(this, client));
    },
    
    function usersTable(err, client) {
      var self = this;
      client.query(usersTableQuery, pgReply.bind(this, client));
    },

    function campaignsTable(err, client) {
      var self = this;
      client.query(campaignsTableQuery, pgReply.bind(this, client));
    },

    function scraperJobsTable(err, client) {
      var self = this;
      client.query(scraperJobsTableQuery, pgReply.bind(this, client));
    },

    function urisTable(err, client) {
      var self = this;
      client.query(urisTableQuery, pgReply.bind(this, client));
    },

    function uriRelationsTable(err, client) {
      var self = this;
      client.query(uriRelationsQuery, pgReply.bind(this, client));
    },

    function verificationsTable(err, client) {
      var self = this;
      client.query(verificationsTableQuery, pgReply.bind(this, client));
    },

    function downloadsTable(err, client) {
      var self = this;
      client.query(downloadsTableQuery, pgReply.bind(this, client));
    },

    function noticesTable(err, client) {
      var self = this;
      client.query(noticesTableQuery, pgReply.bind(this, client));
    },
    
    function done(err, client) {
      if (err) {
        console.log(err);
      } else {
        console.log('Successfuly setup database schemas');
      }
      pg.end();
    }
  );
}

main();