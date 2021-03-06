#!/bin/sh

echo "HTTP/1.0 200 OK"
echo "Content-type: text/plain"
echo ""

repoUrl="https://github.com/open-learning-exchange/myplanet"
repoApkName="myPlanet.apk"
localApkName="/usr/share/nginx/html/fs/myPlanet.apk"

latestReleaseUrl="$repoUrl/releases/latest"
releaseUrl=$(curl -L "$latestReleaseUrl" -w "%{url_effective}" -o /dev/null -s)
tag=$(echo "$releaseUrl" | sed -r 's/.*\/(.*)/\1/')

downloadUrl="$repoUrl/releases/download/$tag/$repoApkName"

curl -s "$downloadUrl" -o "$localApkName.tmp" -L

if [ -f "$localApkName" ] && echo "$(sha256sum $localApkName | head -c64)  $localApkName.tmp" | sha256sum -s -c -; then
  echo "The file hasn't changed."
  rm -rf "$localApkName.tmp"
else
  echo "New file found."
  mv "$localApkName.tmp" "$localApkName"
fi
