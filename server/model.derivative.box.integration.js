/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

'use strict'; // http://www.w3schools.com/js/js_strict.asp

// token handling in session
let token = require('./token');

// web framework
let express = require('express');
let router = express.Router();
let bodyParser = require('body-parser');
let jsonParser = bodyParser.json();

// config information, such as client ID and secret
let config = require('./config');

// box sdk: https://github.com/box/box-node-sdk/
let BoxSDK = require('box-node-sdk');

// forge
let ForgeSDK = require('forge-apis');

let request = require('request');

router.post('/integration/sendToTranslation', jsonParser, function (req, res) {
  let boxFileId = req.body.boxfile;
  let tokenSession = new token(req.session);
  tokenSession.getTokenInternal(function (tokenInternal) {

    let sdk = new BoxSDK({
      clientID: config.box.credentials.client_id, // required
      clientSecret: config.box.credentials.client_secret // required
    });

    let box = sdk.getBasicClient(tokenSession.getBoxToken());
    box.users.get(box.CURRENT_USER_ID, null, function (err, user) {
      if (err || user == null) {
        console.log('model.derivative.box.integration:sentToTranslation:box.user.get => ' + err);
        res.status(500).json({error: 'Cannot get Box user information, please try again.'});
        return;
      }

      // Forge OSS Bucket Name: username + userId (no spaces, lower case)
      // that way we have one bucket for each Box account using this application
      let ossBucketKey = config.credentials.client_id.toLowerCase() + (user.name.replace(/\W+/g, '') + user.id).toLowerCase();

      let buckets = new ForgeSDK.BucketsApi();
      let objects = new ForgeSDK.ObjectsApi();
      let postBuckets = new ForgeSDK.PostBucketsPayload();
      postBuckets.bucketKey = ossBucketKey;
      postBuckets.policyKey = "transient"; // expires in 24h

      buckets.createBucket(postBuckets, {}, null, tokenInternal).catch(function (err) {console.log(err);}).then(function () {

        box.files.get(boxFileId, null, function (err, fileInfo) {
          let fileName = fileInfo.name;
          let ossObjectName = boxFileId + '.' + re.exec(fileName)[1]; // boxId + fileExtension (required)

          // at this point the bucket exists (either created or already there)
          objects.getObjects(ossBucketKey, {'limit': 100}, null, tokenInternal).then(function (response) {
            let alreadyTranslated = false;
            let objectsInBucket = response.body.items;
            objectsInBucket.forEach(function (item) {
              if (item.objectKey === ossObjectName) {
                res.status(200).json({
                  readyToShow: true,
                  status: 'File already translated.',
                  objectId: item.objectId,
                  urn: item.objectId.toBase64()
                });
                alreadyTranslated = true;
              }
            });

            if (!alreadyTranslated) {
              // prepare to download from Box
              box.files.getReadStream(boxFileId, null, function (err, filestream) {
                // upload to Forge OSS
                let mineType = getMineType(fileName);
                request({
                  url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + ossBucketKey + '/objects/' + ossObjectName,
                  method: "PUT",
                  headers: {
                    'Authorization': 'Bearer ' + tokenInternal.access_token,
                    'Content-Type': mineType
                  },
                  body: filestream
                }, function (error, response, body) {
                  // now translate to SVF (Forge Viewer format)
                  let ossUrn = JSON.parse(body).objectId.toBase64();

                  let derivative = new ForgeSDK.DerivativesApi();
                  derivative.translate(translateData(ossUrn), {}, null, tokenInternal).then(function (data) {
                    res.status(200).json({
                      readyToShow: false,
                      status: 'Translation in progress, please wait...',
                      urn: ossUrn
                    });
                  }).catch(function (e) { res.status(500).json({error: e.error.body}) });
                });
              });
            }
          }).catch(function (e) { console.log(e); res.status(500).json({error: e.error.body}) });;
        });
      });
    });
  });
});

router.post('/integration/isReadyToShow', jsonParser, function (req, res) {
  let ossUrn = req.body.urn;

  let tokenSession = new token(req.session);
  tokenSession.getTokenInternal(function (tokenInternal) {
    let derivative = new ForgeSDK.DerivativesApi();
    derivative.getManifest(ossUrn, {}, null, tokenInternal).then(function (response) {
      let manifest = response.body;
      if (manifest.status === 'success') {
        res.status(200).json({
          readyToShow: true,
          status: 'Translation completed.',
          urn: ossUrn
        });
      }
      else {
        res.status(200).json({
          readyToShow: false,
          status: 'Translation ' + manifest.status + ': ' + manifest.progress,
          urn: ossUrn
        });
      }
    }).catch(function (e) { res.status(500).json({error: e.error.body}); });
  });
});

String.prototype.toBase64 = function () {
  return new Buffer(this).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function translateData(ossUrn) {
  let postJob =
  {
    input: {
      urn: ossUrn
    },
    output: {
      formats: [
        {
          type: "svf",
          views: ["2d", "3d"]
        }
      ]
    }
  };
  return postJob;
}

let re = /(?:\.([^.]+))?$/; // regex to extract file extension

function getMineType(fileName) {
  let extension = re.exec(fileName)[1];
  let types = {
    'png': 'application/image',
    'jpg': 'application/image',
    'txt': 'application/txt',
    'ipt': 'application/vnd.autodesk.inventor.part',
    'iam': 'application/vnd.autodesk.inventor.assembly',
    'dwf': 'application/vnd.autodesk.autocad.dwf',
    'dwg': 'application/vnd.autodesk.autocad.dwg',
    'f3d': 'application/vnd.autodesk.fusion360',
    'f2d': 'application/vnd.autodesk.fusiondoc',
    'rvt': 'application/vnd.autodesk.revit'
  };
  return (types[extension] != null ? types[extension] : 'application/' + extension);
}

module.exports = router;
