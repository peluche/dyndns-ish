#!/bin/bash
sudo DNSPORT=53 PORT=5003 node app.js | tee -a log/dyndns.log
