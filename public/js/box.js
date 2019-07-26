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

$(document).ready(function () {
  var auth = isBoxAuthorized();
  if (!isBoxAuthorized()) {
    $('#refreshBoxTree').hide();
    $('#loginBox').click(boxSignIn);
  }
  else {
    $('#loginBox').hide();
    $('#refreshBoxTree').show();
    $('#refreshBoxTree').click(function(){
      $('#myBoxFiles').jstree(true).refresh();
    });
    prepareBoxTree();
  }
});

function boxSignIn() {
  jQuery.ajax({
    url: '/box/authenticate',
    success: function (rootUrl) {
      location.href = rootUrl;
    }
  });
}

function isBoxAuthorized() {
  var ret = 'false';
  jQuery.ajax({
    url: '/box/isAuthorized',
    success: function (res) {
      ret = res;
    },
    async: false // this request must be synchronous for the Forge Viewer
  });
  return (ret === 'true');
}

function prepareBoxTree() {
  $('#myBoxFiles').jstree({
    'core': {
      'themes': {"icons": true},
      'data': {
        "url": '/box/getTreeNode',
        "dataType": "json",
        'multiple': false,
        "data": function (node) {
          return {"id": node.id};
        }
      }
    },
    'types': {
      'default': {
        'icon': 'glyphicon glyphicon-cloud'
      },
      'file': {
        'icon': 'glyphicon glyphicon-file'
      },
      'folder': {
        'icon': 'glyphicon glyphicon-folder-open'
      }
    },
    "plugins": ["types", "state", "sort", "contextmenu"],
    contextmenu: {items: boxCustomMenu}
  }).bind("activate_node.jstree", function (evt, data) {
    if (data != null && data.node != null) {
      translateFile(data.node);
    }
  });
}

function translateFile(boxNode) {
  isFileSupported(boxNode.text, function (supported) {
    if (!supported) {
      $.notify('File "' + boxNode.text + '" cannot be viewed, format not supported.', 'warn');
      return;
    }

    $.notify('Preparing to view "' + boxNode.text + '", please wait...', 'info');

    jQuery.ajax({
      url: '/integration/sendToTranslation',
      contentType: 'application/json',
      type: 'POST',
      dataType: 'json',
      data: JSON.stringify({
        'boxfile': boxNode.id
      }),
      success: function (res) {
        $.notify(res.status + (res.readyToShow ? ' Launching viewer.' : ''), 'info');
        if (res.readyToShow)
          launchViewer('forgeViewer', res.urn); // ready to show! launch viewer
        else
          wait(res.urn); // not ready to show... wait 5 seconds
      },
      error: function (res) {
        res = JSON.parse(res.responseText);
        $.notify(res.error, 'error');
      }
    });

  });
}

function wait(urn) {
  setTimeout(function () {
    jQuery.ajax({
      url: '/integration/isReadyToShow',
      contentType: 'application/json',
      type: 'POST',
      dataType: 'json',
      data: JSON.stringify({
        'urn': urn
      }),
      success: function (res) {
        if (res.readyToShow) {
          $.notify('Ready! Launching viewer.', 'info');
          launchViewer('forgeViewer', res.urn);
        }
        else {
          $.notify(res.status, 'warn');
          wait(res.urn);
        }
      },
      error: function (res) {
        res = JSON.parse(res.responseText);
        $.notify(res.error, 'error');
      }
    });
  }, 5000);
}

function boxCustomMenu(boxNode) {
  var items;

  if (boxNode.type == 'file') {
    items = {
      renameItem: {
        label: "Download as OBJ",
        icon: "/img/autodesk-forge.png",
        action: function () {
          isFileSupported(boxNode.text, function (supported) {
            if (supported) {
              $.notify('Sorry, not implemented on this sample (WIP)', 'error');
            }
            else
              $.notify('Cannot extract OBJ, format not supported.', 'error');
          });
        }
      }
    };
  }
  return items;
}

var re = /(?:\.([^.]+))?$/; // regex to extract file extension

function isFileSupported(fileName, callback) {
  var extension = (re.exec(fileName)[1]).toLowerCase();
  jQuery.ajax({
    url: '/md/viewerFormats',
    contentType: 'application/json',
    type: 'GET',
    dataType: 'json',
    success: function (supportedFormats) {
      // for a zip we need to define the rootFilename, need extra work (WIP)
      // let's remove it from the supported formats, for now
      supportedFormats.splice(supportedFormats.indexOf('zip'),1);
      var supported = ( jQuery.inArray(extension, supportedFormats) >= 0);
      callback(supported);
    },
    error: function (res) {
      res = JSON.parse(res.responseText);
      $.notify(res.error, 'error');
    }
  });
}