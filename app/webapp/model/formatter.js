sap.ui.define([], function () {
    "use strict";

    return {
        formatFileSize: function (bytes) {
            if (!bytes) return "";
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        }
    };
});
