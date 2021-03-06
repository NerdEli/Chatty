// ! hit or miss, i guess they never miss, huh?
var fs = require('fs');
var express = require('express');
var app = express();
var rtg = require('random-token-generator');

// ! HTTP ROUTING
var http = express();
http.get('*', function (req, res) {
    res.redirect('https://' + req.headers.host + req.url);
});
// ! HTTP ROUTING

var https = require('https');
var privateKey = fs.readFileSync('./../data/key.pem', 'utf8');
var certificate = fs.readFileSync('./../data/cert.pem', 'utf8');
var credentials = {
    key: privateKey,
    cert: certificate
};
var httpsServer = https.createServer(credentials, app);
var io = require('socket.io').listen(httpsServer);
var SHA256 = require('js-sha256').sha256;
const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database('../data/users.db');

db.run(`CREATE TABLE IF NOT EXISTS Users(USERNAME text, PASSWORD text, ADMIN text, TOKEN text)`);

const PORT = 443;

app.use(express.static(__dirname + '/public'));
app.disable('x-powered-by');
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('*', function (req, res) {
    res.sendFile(__dirname + "/err/404.html");
});

httpsServer.listen(PORT, function () {
    console.log(`Now listening to * on port ${PORT}`);
});

var admins = [];

db.all(`SELECT * from Users`, [], function (err, rows) {
    if (err) {
        throw err;
    }
    rows.forEach(function (element) {
        if (element.ADMIN == "true")
            admins.push(element.USERNAME);
    });
});

var connected = [];
var timestamp = "";

setInterval(function () {
    var date = new Date();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = " AM";
    if (minutes < 10) {
        minutes = "0" + minutes;
    }
    if (hours < 10) {
        hours = "0" + hours;
    } else if (hours > 12) {
        hours = hours % 12;
        ampm = " PM";
    }
    if (hours == 0) hours = 12;
    timestamp = date.toDateString() + " @ " + hours + ":" + minutes + ampm;
}, 1000);

io.on('connection', function (socket) {
    socket.on('MESSAGE', function (msg) {
        var json = {};
        try {
            json = JSON.parse(msg);
        } catch (e) {
            console.log(e);
            return;
        }

        if (json.TOKEN)

            if (json.TYPE == "SOCKIN") {
                if (json.TOKEN != undefined) {
                    var noUserFound = false;
                    connected.forEach(function (connectedUser) {
                        if (connectedUser.token != json.TOKEN) {
                            noUserFound = true;
                        }
                    });
                    if (!noUserFound) {
                        connected.push({
                            "token": json.TOKEN,
                            "channel": json.CHANNEL.toLowerCase(),
                            "ssId": socket.id
                        });
                        updateUsers();
                    }
                }
            }

        if (json.TYPE == "SOCKOUT") {
            if (json.TOKEN != undefined) {
                var noUserFound;
                connected.forEach(function (connectedUser) {
                    if (connectedUser.token == json.TOKEN) {
                        noUserFound = connectedUser;
                    }
                });
                if (noUserFound != null) {
                    connected.splice(connected.find(function () {
                        return noUserFound.token == json.TOKEN;
                    }));
                    updateUsers();
                }
            }
        }

        /*if (json.TYPE == "CHECKTOKEN") { //TODO: Make this actually work
            var goodToken = false;
            db.all(`SELECT * from Users`, [], function (err, rows) {
                if (err) {
                    throw err;
                }
                rows.forEach(function (element) {
                    if (element.TOKEN == json.TOKEN) {
                        goodToken = true;
                    }
                });
            });
            if (goodToken) {
                socket.emit("MESSAGE", JSON.stringify({
                    "TYPE": "CHECKTOKEN",
                    "MESSAGE": "OK"
                }));
            } else {
                socket.emit("MESSAGE", JSON.stringify({
                    "TYPE": "CHECKTOKEN",
                    "MESSAGE": "INVALID"
                }));
            }
        }*/


        if (json.TYPE == "MESSAGE") {
            var newmessage = json.MESSAGE.replaceAll("<", "&lt").replaceAll(">", "&gt;").trim();
            if (!checkMsg(newmessage)) return;
            refreshDb();
            db.all(`SELECT * from Users`, [], function (err, rows) {
                if (err) {
                    throw err;
                }
                rows.forEach(function (element) {
                    if (element.TOKEN == json.TOKEN) {
                        var admin = element.ADMIN == 'true';
                        connected.forEach(function (conUser) {
                            var sockId = conUser.ssId;
                            if (conUser.channel != json.CHANNEL.toLowerCase()) return;
                            io.sockets.connected[sockId].emit("MESSAGE", JSON.stringify({
                                "TYPE": "MESSAGE",
                                "USERNAME": element.USERNAME,
                                "MESSAGE": newmessage,
                                "CHANNEL": json.CHANNEL.toLowerCase(),
                                "ADMIN": admin,
                                "TIMESTAMP": timestamp
                            }));
                        });
                        writeMessage(element.USERNAME, json.MESSAGE, json.CHANNEL.toLowerCase());
                    }
                });
            });
        }
        if (json.TYPE == "SIGNIN") {
            var oof = false;
            db.all(`SELECT * from Users`, [], function (err, rows) {
                if (err) {
                    throw err;
                }
                rows.forEach(function (element) {
                    if (element.USERNAME == json.USERNAME && element.PASSWORD == SHA256(json.PASSWORD)) {
                        socket.emit("MESSAGE", JSON.stringify({
                            "TYPE": "SIGNIN",
                            "MESSAGE": element.TOKEN
                        }));
                        oof = true;
                    }
                });
            });
            if (!oof)
                return socket.emit("MESSAGE", JSON.stringify({
                    "TYPE": "SIGNIN",
                    "MESSAGE": "USERDATA_INVALID"
                }));

        }
        if (json.TYPE == "SIGNUP") {
            var done = false;
            db.all("select * from Users", [], function (err, rows) {
                if (err) {
                    throw err;
                }
                rows.forEach(function (element) {
                    if (element.USERNAME == json.USERNAME) {
                        socket.emit("MESSAGE", JSON.stringify({
                            "TYPE": "SIGNUP",
                            "MESSAGE": "USERNAME_TAKEN"
                        }));
                        done = true;
                        return;
                    }
                });
                if (!usernameChecker(json.USERNAME)) {
                    socket.emit("MESSAGE", JSON.stringify({
                        "TYPE": "SIGNUP",
                        "MESSAGE": "CHAR_INVALID"
                    }));
                }
                rtg.generateKey({
                    len: 32,
                    string: true,
                    strong: true,
                    retry: true
                }, function (err, key) {
                    if (done) return;

                    db.run(`insert into Users values('${json.USERNAME}', '${SHA256(json.PASSWORD)}', 'false', '${key}')`);
                    socket.emit("MESSAGE", JSON.stringify({
                        "TYPE": "SIGNUP",
                        "MESSAGE": key
                    }))
                });
            });
        }
        if (json.TYPE == "MESSAGES") {
            refreshDb();
            var channel = json.CHANNEL.toLowerCase();
            if (channel == "") return;
            var msgarray = [];
            fs.readdir("./../data/logs/", function (err, files) {
                var foundFile = false;
                files.forEach(function (filename) {
                    if (filename == channel + ".json") {
                        foundFile = true;
                        fs.readFile("./../data/logs/" + filename, "utf8", function (err, data) {
                            var json = JSON.parse(data);
                            var max = 10;
                            for (i = 0; i < max; i++) {
                                if (json.logs[i] == null) {
                                    max--;
                                    continue;
                                }
                                var admin = false;
                                admins.forEach(function (username) {
                                    if (username == json.logs[i].username)
                                        admin = true;
                                });
                                var message = {
                                    "username": json.logs[i].username,
                                    "message": json.logs[i].message,
                                    "admin": admin,
                                    "timestamp": json.logs[i].timestamp
                                };
                                msgarray.unshift(message);
                            }
                            socket.emit("MESSAGE", JSON.stringify({
                                "TYPE": "MESSAGES",
                                "MESSAGE": msgarray
                            }));
                        });
                    }
                });
                if (!foundFile) {
                    socket.emit("MESSAGE", JSON.stringify({
                        "TYPE": "MESSAGES",
                        "MESSAGE": []
                    }));
                }
            });
        }
    });
});

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

function writeMessage(username, message, channel) {
    if (!checkMsg(message)) return;
    var files = fs.readdirSync("./../data/logs", "utf8");
    var logIsSaved = false;
    files.forEach(function (logname) {
        if (logname == channel + ".json") {
            logIsSaved = true;
            var json = JSON.parse(fs.readFileSync("./../data/logs/" + logname, "utf8"));
            json.logs.unshift({
                "username": username,
                "message": message,
                "timestamp": timestamp
            });
            fs.writeFileSync("./../data/logs/" + logname, JSON.stringify(json));
        }
    });
    if (!logIsSaved) {
        var jsonDefault = {
            "logs": []
        };
        fs.writeFileSync("./../data/logs/" + channel + ".json", JSON.stringify(jsonDefault));
        writeMessage(username, message, channel);
    }
}

function refreshDb() {
    db.close();
    db = new sqlite3.Database('../data/users.db');
}

function checkMsg(msg) {
    var invalids = ["", " "];
    for (i = 0; i < invalids.length; i++) {
        if (msg == invalids[i])
            return false;
    }
    return true;
}

function updateUsers() {
    var onlineusers = [];
    db.all("select * from Users", [], function (err, rows) {
        if (err) {
            throw err;
        }
        rows.forEach(function (element) {
            connected.forEach(function (user) {
                if (element.TOKEN == user.token) {
                    var admin = false;
                    admins.forEach(function (adminis) {
                        if (adminis == element.USERNAME)
                            admin = true;
                    });
                    onlineusers.push({
                        "username": element.USERNAME,
                        "channel": user.channel,
                        "admin": admin
                    });
                }
            });
        });
        io.emit("MESSAGE", JSON.stringify({
            "TYPE": "USERS",
            "MESSAGE": onlineusers
        }));
    });
}

function usernameChecker(username) {
    var usernameRegex = /^[a-zA-Z0-9]+$/;
    var validUsername = username.match(usernameRegex);
    if (validUsername == null) {
        return false;
    }
}