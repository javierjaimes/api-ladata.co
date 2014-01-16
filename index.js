var express = require( 'express' ),
    url = require('url'),
    cradle = require('cradle'),
    passport = require( 'passport' ),
    BasicStrategy = require('passport-http').BasicStrategy,
    ClientPasswordStrategy = require('passport-oauth2-client-password').Strategy,
    BearerStrategy = require('passport-http-bearer').Strategy,
    oauth2orize = require( 'oauth2orize' ),
    hat = require( 'hat' ),
    app = express(),
    server = oauth2orize.createServer();

/*****
 * Database Connection
 */
if( process.env.CLOUDANT_URL ){
  console.log( 'CONNECT CLOUDANT' );

  var cloudant_url = url.parse( process.env.CLOUDANT_URL);
  var cloudant_auth = cloudant_url.auth.split( ':' );
  console.log( cloudant_auth );
  cradle.setup({
    'host': cloudant_url.hostname,
    'auth': {
      'username': cloudant_auth[0],
      'password': cloudant_auth[1]
    },
    'cache': true,
    'raw': false 
  })
  var db = new(cradle.Connection)().database('ladata-co');
}else{
  var db = new(cradle.Connection)().database( 'ladata-co' );
}
db.exists(function (err, exists) {
  if (err) {
    console.log('error', err);
  } else if (exists) {
    console.log('the force is with you.');
  } else {
    console.log('database does not exists.');
    db.create();
    /* populate design documents */
  }
});


app.use(express.logger());
app.use(express.cookieParser());
app.use(express.bodyParser());
app.use(express.session({ secret: 'keyboard cat' }));

app.use(passport.initialize());
app.use(passport.session());
app.use(app.router);
app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

/****
 * PASSPORT CONFIG
 */

passport.use(new BasicStrategy(
  function(username, password, done) {
    console.log( 'Passport Basic Strategy' );

    //Get Client
    db.get( username, function( err, res ){
      console.log( 'show result' );
      console.log( res );
      console.log( typeof res );
      if( err ){ return done( err ) };
      if( res == 'undefined' ){ return done( null, false) };

      var client = res;
      if( client.secret != password) { return done(null, false); };

      return done(null, client);
    })

    /*db.clients.findByClientId(username, function(err, client) {
      if (err) { return done(err); }
      if (!client) { return done(null, false); }
      if (client.clientSecret != password) { return done(null, false); }
      return done(null, client);
    });*/
  }
));

passport.use(new ClientPasswordStrategy(
  function(clientId, clientSecret, done) {
    console.log( 'Passport Client Strategy' );
    console.log( clientId, clientSecret );
    db.get( clientId, function( err, res ){
      if (err) { return done(err); }
      if( res == 'undefined' ){ return done( null, false) };

      var client = res;
      if (client.secret != clientSecret) { return done(null, false); }
      return done(null, client);
    })
  }
));

passport.use(new BearerStrategy(
  function(accessToken, done) {
    console.log( 'Passpor Bearer Strategy' );
    db.view( 'tokens/all', { key: accessToken }, function( err, res ){
      console.log( 'Find TOken' );
      if( err ){ console.log( err ); }

      if (err) { return done(err); }
      if ( res.length <= 0) { return done(null, false); }
    
      done( null, { id: 1, name: 'javier' }, { scope: '*' });
    })
  }
));

/****
 * OAuth2
 *
 */
server.serializeClient(function(client, done) {
  return done(null, client.id);
});

server.deserializeClient(function(id, done) {
  db.get( id, function (err, client) {
    if( err ){  return done( err ) }
    return done(null, client);
  });
});

server.exchange(oauth2orize.exchange.code(function(client, code, redirectURI, done) {
  console.log( 'Exchange Token' );
  console.log( client );
  console.log( code );
  console.log( redirectURI );

  var token = hat(256, 16);
  //done(null, token);

  db.get( code, function( err, res ){
    if( err ){ return done(err); }
    if( res == undefined ){ return done(null, false ); }
    if (client.id !== res.client_id) { return done(null, false); }
    //if (redirectURI !== authCode.redirectURI) { return done(null, false); }

    var code = res;

    db.remove( code.id, function( err, res ){
      if( err ){ return done( err ); }

      db.save({
        'token': token, 'user_id': code.user_id, 'client_id': code.client_id, 'type': 'tokens', 'created_at': new Date()
      }, function( err, res ){
         if (err) { return done(err); }
         done(null, token);
      })
    })
  })

}));

/****
 * ROUTES
 */
app.all('*', function(req, res, next){
  if (!req.get('Origin')) return next();
  // use "*" here to accept any origin
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type');
  // res.set('Access-Control-Allow-Max-Age', 3600);
  if ('OPTIONS' == req.method) return res.send(200);
  next();
});
app.get( '/', function( req, res ){
  res.send( 'Api LaData.co -v 0.1' );
})
app.post('/oauth/token', 
  passport.authenticate(['basic', 'oauth2-client-password'], { session: false }), 
  server.token(),
  server.errorHandler()
);
app.get( '/datasets(?:\/next\/:docid)?',  passport.authenticate('bearer', { session: false }), function( req, res){
  console.log( typeof req.params.docid );

  limit = 25;
  next_startkey = (req.params.docid != undefined )? req.params.docid:0;
  next_startkey_docid = ( next_startkey != false )? next_startkey:0;
  //skip = ( req.params.page != undefined )? ( +req.params.page - 1 ) * limit: 0;

  db.view( 'datasets/all', { startkey: next_startkey, startkey_docid:  next_startkey_docid, limit: limit + 1, reduce: false }, function( err, docs ){
    console.log( err );
    console.log( docs );
    console.log( docs.total_rows );
    console.log( docs.offset );
    //console.log( docs[ limit ].id );

    total_rows = docs.total_rows;
    offset = docs.offset;
    
    if( total_rows > limit ){
      next_startkey = ( (offset * limit) ==  total_rows )? false:docs[ limit ].id;
    }else{
      next_startkey = false;
    }

    lists = [];
    for( var i =0; i < limit; i++ ){
      if( i < total_rows ){
        list = {};
        list.id = docs[i].id;
        list.name = docs[i].value.name;
        list.description = docs[i].value.description;
        list.created = docs[i].value.created_at;
        lists.push( list );
      }
    }
    res.json({ 'next': next_startkey, 'datasets': lists });
  } )
} )
app.get( '/datasets/:id/next/:docid', passport.authenticate( 'bearer', {session: false} ) , function( req, res ){
  limit = 2
  next_startkey = (req.params.docid != undefined )? req.params.docid:0;
  next_startkey_docid = ( next_startkey != false )? next_startkey:0;
  
  console.log( 'next_startkey' );
  console.log( next_startkey );

  db.view( 'data/byDataset', { 'key':req.params.id, 'startkey_docid':  next_startkey_docid, 'limit': limit + 1 }, function( err, docs ){
    console.log( err );
    console.log( docs );
    total_rows = docs.total_rows;
    offset = docs.offset;
    next_startkey = ( (offset * limit) ==  total_rows )? false:docs[ limit ].id;

    lists = [];
    for( var i =0; i < limit; i++ ){
      list = {};
      list.id = docs[i].id;
      list.values = docs[i].value.columns;
      list.created = docs[i].value.created_at;
      lists.push( list );
    }
    res.json({ 'next': next_startkey, 'rows': lists });
  } )
})
app.get( '/datasets/:id/', passport.authenticate( 'bearer', { session: false }), function( req, res){
  limit = 25;

  dataset_id = req.params.id;
  db.get( dataset_id, function( err, doc ){
    dataset = doc;
    console.log(  dataset.fields );

    db.view( 'data/byDataset', { 'key':req.params.id, 'limit': limit + 1, 'reduce': false }, function( err, docs ){
      console.log( docs );
      total_rows = docs.total_rows;
      offset = docs.offset;
      
      if( total_rows > limit ){
        next_startkey = ( (offset * limit) ==  total_rows )? false:docs[ limit ].id;
      }else{
        next_startkey = false;
      }

      lists = [];
      for( var i =0; i < limit; i++ ){
        console.log( i, limit, total_rows );
        if( i < total_rows - 1 ){
          list = {};
          list.id = docs[i].id;

          fields = {};
          for( var j in docs[i].value.fields ){
            console.log(j);
            var field_name = dataset.fields[j].name;
            var field_value = docs[i].value.fields[j];


            fields[field_name] = field_value;
          }
          console.log( fields );

          list.values = fields;

          list.created = docs[i].value.created_at;
          lists.push( list );
        }
      }
      res.json({ 'next': next_startkey, 'data': lists });
    } )
 
  })
 
} )

app.listen( process.env.PORT || 3002);
