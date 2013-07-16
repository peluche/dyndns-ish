#!/bin/bash
sudo DNSPORT=53 PORT=2888 node app.js | tee log/dyndns.log
