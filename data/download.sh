#!/bin/sh

# Download cities database

YEAR=$(date +"%Y")
MONTH=$(date +"%m")

wget -O city.mmdb.gz https://download.db-ip.com/free/dbip-city-lite-${YEAR}-${MONTH}.mmdb.gz
gunzip -f city.mmdb.gz

# This should also create a file with the version downloaded.
# And the license of the database.