// Plain browser script for the server-address window (no bundler, no
// framework). Talks only to window.posDesktopSetup, exposed by url-preload.ts.
/* global posDesktopSetup */
(function () {
  "use strict";

  var form = document.getElementById("address-form");
  var addressInput = document.getElementById("address");
  var errorParagraph = document.getElementById("error");
  var saveButton = document.getElementById("save");
  var cancelButton = document.getElementById("cancel");

  function showError(message) {
    errorParagraph.textContent = message || "";
  }

  posDesktopSetup.current().then(function (origin) {
    if (origin) {
      addressInput.value = origin;
    } else {
      cancelButton.disabled = true;
    }
  });

  // Submit = the primary button OR Enter in the field.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    showError("");
    saveButton.disabled = true;
    posDesktopSetup.save(addressInput.value).then(function (result) {
      saveButton.disabled = false;
      if (!result.ok) {
        showError(result.error);
      }
    });
  });

  cancelButton.addEventListener("click", function () {
    if (!cancelButton.disabled) {
      posDesktopSetup.cancel();
    }
  });
})();
