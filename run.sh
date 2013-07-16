#!/bin/bash
sudo DNSPORT=53 PORT=2888 node app.js | tee -a log/dyndns.log
