// Plain browser script for the POS address window (no bundler, no framework): the Android start screen's look and words
// (native apps 2.0, spec §9). Talks only to window.posDesktopSetup, exposed by url-preload.ts. The main process reads the
// address by the Android app's rules, checks it once and saves it, and answers with the words to show.
/* global posDesktopSetup */
(function () {
  "use strict";

  var HELP_TITLE = "Your workspace";
  var HELP_BODY =
    "Type your workspace name, or the full address shared by your administrator. We’ll remember it for next time.";
  var ERROR_TITLE = "Check the address";
  var SAVE_FAILED = "The address could not be saved. Close the app and try again.";

  var form = document.getElementById("address-form");
  var field = document.getElementById("field");
  var addressInput = document.getElementById("address");
  var clearButton = document.getElementById("clear");
  var hint = document.getElementById("hint");
  var hintTitle = document.getElementById("hint-title");
  var hintBody = document.getElementById("error");
  var saveButton = document.getElementById("save");
  var saveLabel = document.getElementById("save-label");
  var cancelButton = document.getElementById("cancel");
  var product = document.getElementById("product");
  var busy = false;

  if (posDesktopSetup.version) {
    product.textContent = "POS Software by sandbee · " + posDesktopSetup.version;
  }

  function showError(message) {
    var hasError = Boolean(message);
    field.classList.toggle("error", hasError);
    hint.classList.toggle("error", hasError);
    hintTitle.textContent = hasError ? ERROR_TITLE : HELP_TITLE;
    hintBody.textContent = hasError ? message : HELP_BODY;
  }

  function updateClear() {
    clearButton.hidden = busy || addressInput.value.length === 0;
  }

  // While the address is checked (at most 5 seconds) the form waits: "Connecting…".
  function setBusy(on) {
    busy = on;
    addressInput.readOnly = on;
    saveButton.disabled = on;
    saveLabel.textContent = on ? "Connecting…" : "Open POS";
    updateClear();
  }

  // A saved address means "Change POS address…": the window may be cancelled (the main process checks it too).
  posDesktopSetup.current().then(function (origin) {
    if (origin) {
      addressInput.value = origin;
      cancelButton.hidden = false;
    }
    updateClear();
  });

  addressInput.addEventListener("input", function () {
    showError("");
    updateClear();
  });

  clearButton.addEventListener("click", function () {
    addressInput.value = "";
    showError("");
    updateClear();
    addressInput.focus();
  });

  // Submit = Open POS OR Enter in the field.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    showError("");
    setBusy(true);
    posDesktopSetup.save(addressInput.value).then(
      function (result) {
        setBusy(false);
        if (!result.ok) {
          showError(result.error);
          addressInput.focus();
        }
      },
      function () {
        setBusy(false);
        showError(SAVE_FAILED);
      },
    );
  });

  cancelButton.addEventListener("click", function () {
    if (!cancelButton.hidden && !busy) {
      posDesktopSetup.cancel();
    }
  });

  // Esc cancels, only when Cancel is shown.
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !cancelButton.hidden && !busy) {
      posDesktopSetup.cancel();
    }
  });
})();
