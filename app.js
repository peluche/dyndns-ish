var fs = require('fs');
var crypto = require('crypto');
var http = require('http');
var express = require('express');
var path = require('path');
var dnsd = require('native-dns');
var levelup = require('levelup');
var dns = require('native-dns');

var records = {};

// -- starting leveldb --
var dbname = process.env.DB || './mydb';
var db = levelup(dbname, function(err, db) {
    if (err){ throw err; }
    console.log('[+] levelDB: database opened [ %s ]', dbname);
    // init the store here
    db.get('records', function(err, data){
        if (err){ return console.log('[-] no records loaded from db'); }
        records = JSON.parse(data);
        console.log('[+] records laoded: ', records);
    });
});

function sync2db(data) {
    var data_json = JSON.stringify(data);
    db.put('records', data_json, function(err){
        if (err){ return console.log('[-] error syncing to db'); }
    });
}

// -- leveldb loaded --

var app = express();
var conf_secret = JSON.parse(fs.readFileSync('./secret/secret.json'));

app.configure(function() {
  app.set('port', process.env.PORT || 3000);
  // app.use(express.favicon(__dirname + '/public/favicon.ico'));
  app.use(express.bodyParser());
  app.use(express.cookieParser(conf_secret.secret));
  app.use(express.session({
      secret: conf_secret.secret,
      maxAge: 12345
  }));
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function() {
  app.use(express.errorHandler());
});

// -- configuration end here --

var basic_auth = express.basicAuth(function(user, pass) {     
    var valid_creds = conf_secret.creds;
    return user in valid_creds &&
        valid_creds[user] == crypto.createHash('sha1').update(pass).digest('hex');
}, '');

app.get('/', basic_auth, function(req, res) {
    // TODO rewrite me with css
    // validation, ajax and shit ...
    res.render('form.ejs', {layout: false});
});

app.get('/list', basic_auth, function(req, res) {
    res.render('list.ejs', {records: records, layout: false});
});

function h_jm(res, data) {
    // simple helper to send json message
    return res.end(JSON.stringify(data));
}

function h_je(res, data) {
    // simple helper to send json message
    res.writeHead(500);
    res.end(JSON.stringify(data));
}

app.post('/dyn/me', basic_auth, function(req, res) {
    var regex_ip = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
    var rec = (req.body.record || '').trim();
    var ip = (req.ip || '').trim();
    var com = (req.body.comment || '').trim();

    if (ip == '127.0.0.1') {
        // if proxyfied by nginx
        ip = (req.headers['x-real-ip'] || '').trim();
    }
    console.log('[+] dyn me %s', ip);
    if (!rec || !ip){
        return h_je(res, {err: 'record and ip must be filled'});
    }
    if (!regex_ip.test(ip)){
        return h_je(res, {err: 'invalid ip'});
    }

    records[rec] = { record: rec,
                     ip: ip,
                     comment: com
                   };
    sync2db(records);
    return h_jm(res, { ok: 'record created',
                       info: records[rec]
                     });
});

app.post('/records', basic_auth, function(req, res) {
    var regex_ip = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
    var rec = (req.body.record || '').trim();
    var ip = (req.body.ip || '').trim();
    var com = (req.body.comment || '').trim();

    if (!rec || !ip){
        return h_je(res, {err: 'record and ip must be filled'});
    }
    if (!regex_ip.test(ip)){
        return h_je(res, {err: 'invalid ip'});
    }
    if (rec in records){
        return h_je(res, {err: 'record already exists'});
    }

    records[rec] = { record: rec,
                     ip: ip,
                     comment: com
                   };
    sync2db(records);
    return h_jm(res, { ok: 'record created',
                       info: records[rec]
                     });
});

app.get('/records', basic_auth, function(req, res){
    return h_jm(res, { records: records });
});

app.del('/records/:rec', basic_auth, function(req, res){
    var rec = req.params.rec;

    if (! (rec in records)){
        return h_je(res, {err: 'record doesn\'t exist'});
    }
    delete records[rec];
    sync2db(records);
    return h_jm(res, {ok: 'record deleted'});
});

app.put('/records/:rec', basic_auth, function(req, res){
    var regex_ip = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
    var old_rec = (req.params.rec).trim();
    var rec = (req.body.record || '').trim();
    var ip = (req.body.ip || '').trim();
    var com = (req.body.comment || '').trim();

    if (! (old_rec in records)){
        return h_je(res, {err: 'record doesn\'t exists'});
    }
    if (!rec || !ip){
        return h_je(res, {err: 'record and ip must be filled'});
    }
    if (!regex_ip.test(ip)){
        return h_je(res, {err: 'invalid ip'});
    }

    if (old_rec != rec){
        delete records[old_rec];
    }
    records[rec] = { record: rec,
                     ip: ip,
                     comment: com
                   };
    sync2db(records);
    return h_jm(res, { ok: 'record updated',
                       info: records[rec]
                     });
});

http.createServer(app).listen(app.get('port'), function(){
    console.log('[+] express server listening on port [ %s ]', app.get('port'));
});

// -- dns stuff live here --
var server = dns.createServer();

server.on('request', function (request, response){
    var name = request.question[0].name;
    var rec = records[name];
    
    if (!rec) {
        console.log('[-] no record for [%s]', name);
        return ;
    }
    console.log('[+] serving <%s> for [%s]', rec.ip, name);
    response.answer.push(dns.A({
        name: name,
        address: rec.ip,
        ttl: 12
    }));
    response.send();
});

server.on('error', function (err, buff, req, res) {
    console.log(err.stack);
});

server.on('listening', function (foo, bar){
    console.log('[+] dns server started on [ %s ]', dnsport);
});

var dnsport = process.env.DNSPORT || 5353;
server.serve(dnsport);
