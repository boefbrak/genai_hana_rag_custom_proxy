sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/formatter"
], function (Controller, JSONModel, MessageToast, MessageBox, formatter) {
    "use strict";

    return Controller.extend("genai.rag.app.controller.Upload", {
        formatter: formatter,

        onInit: function () {
            this._apiBase = (window.RAG_CONFIG && window.RAG_CONFIG.apiBaseUrl) ||
                "https://trial---shared-sap-core-ai-chatbot-eu10-chatbot-dev-gen6bd87a39.cfapps.eu10-004.hana.ondemand.com";
            this._oDocumentsModel = new JSONModel({ value: [] });
            this.getView().setModel(this._oDocumentsModel, "documents");
            this._loadDocuments();
        },

        _loadDocuments: function () {
            var that = this;
            fetch(this._apiBase + "/api/documents/Documents")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._oDocumentsModel.setData(data);
                })
                .catch(function (err) {
                    console.error("Failed to load documents:", err);
                });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("chat");
        },

        onNavToChat: function () {
            this.getOwnerComponent().getRouter().navTo("chat");
        },

        onTypeMismatch: function () {
            MessageBox.error("Only PDF, TXT, and CSV files are supported.");
        },

        onFileSizeExceed: function () {
            MessageBox.error("File size must not exceed 10 MB.");
        },

        onUpload: function () {
            var oFileUploader = this.byId("fileUploader");
            // Access the native file input element
            var oFileInput = oFileUploader.oFileUpload;
            var oFile = oFileInput && oFileInput.files && oFileInput.files[0];

            if (!oFile) {
                MessageToast.show("Please select a file first.");
                return;
            }

            var oFormData = new FormData();
            oFormData.append("file", oFile);

            this.getView().setBusy(true);
            var that = this;

            fetch(this._apiBase + "/api/documents/upload", {
                method: "POST",
                body: oFormData
            })
            .then(function (response) {
                if (!response.ok) {
                    return response.json().then(function (err) {
                        throw new Error(err.error || "Upload failed");
                    });
                }
                return response.json();
            })
            .then(function (data) {
                MessageToast.show("File uploaded. Processing started...");
                oFileUploader.clear();
                that._loadDocuments();
                // Poll for status updates
                that._pollStatus(data.ID);
            })
            .catch(function (error) {
                MessageBox.error("Upload failed: " + error.message);
            })
            .finally(function () {
                that.getView().setBusy(false);
            });
        },

        _pollStatus: function (docId) {
            var that = this;
            var apiBase = this._apiBase;
            var interval = setInterval(function () {
                fetch(apiBase + "/api/documents/getStatus(documentId='" + docId + "')")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.status === "READY" || data.status === "ERROR") {
                            clearInterval(interval);
                            that._loadDocuments();
                            if (data.status === "READY") {
                                MessageToast.show("Document processed: " + data.chunkCount + " chunks created.");
                            } else {
                                MessageBox.error("Processing failed: " + data.errorMsg);
                            }
                        }
                    })
                    .catch(function () {
                        clearInterval(interval);
                    });
            }, 3000);
        },

        onDocumentPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("documents");
            var sStatus = oContext.getProperty("status");
            if (sStatus === "ERROR") {
                MessageBox.error("Processing error: " + oContext.getProperty("errorMsg"));
            }
        }
    });
});
