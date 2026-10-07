sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("genai.rag.app.controller.Chat", {

        onInit: function () {
            this._apiBase = (window.RAG_CONFIG && window.RAG_CONFIG.apiBaseUrl) ||
                "https://trial---shared-sap-core-ai-chatbot-eu10-chatbot-dev-gen6bd87a39.cfapps.eu10-004.hana.ondemand.com";
            this._oMessagesModel = new JSONModel([]);
            this.getView().setModel(this._oMessagesModel, "messages");

            this._oSessionsModel = new JSONModel({ value: [] });
            this.getView().setModel(this._oSessionsModel, "sessions");

            this._loadSessions();
        },

        _loadSessions: function () {
            var that = this;
            fetch(this._apiBase + "/api/chat/ChatSessions")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._oSessionsModel.setData(data);
                })
                .catch(function (err) {
                    console.error("Failed to load sessions:", err);
                });
        },

        onNavToUpload: function () {
            this.getOwnerComponent().getRouter().navTo("upload");
        },

        onNewSession: function () {
            var that = this;
            var sTitle = "Chat " + new Date().toLocaleString();

            fetch(this._apiBase + "/api/chat/createSession", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: sTitle })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                that.getOwnerComponent().getModel("app").setProperty("/currentSessionId", data.ID);
                that._oMessagesModel.setData([]);
                that._loadSessions();
                MessageToast.show("New chat session created");
            })
            .catch(function (err) {
                MessageToast.show("Failed to create session");
            });
        },

        onSessionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem.getBindingContext("sessions");
            var sSessionId = oContext.getProperty("ID");
            this.getOwnerComponent().getModel("app").setProperty("/currentSessionId", sSessionId);
            this._loadMessages(sSessionId);
        },

        _loadMessages: function (sessionId) {
            var that = this;
            fetch(this._apiBase + "/api/chat/getSessionMessages(sessionId='" + sessionId + "')")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._oMessagesModel.setData(data.value || data || []);
                    that._scrollToBottom();
                })
                .catch(function (err) {
                    console.error("Failed to load messages:", err);
                });
        },

        onSendMessage: function () {
            var oInput = this.byId("messageInput");
            var sMessage = oInput.getValue().trim();
            if (!sMessage) return;

            var sSessionId = this.getOwnerComponent().getModel("app").getProperty("/currentSessionId");
            if (!sSessionId) {
                MessageToast.show("Please create or select a chat session first.");
                return;
            }

            // Add user message to UI
            var aMessages = this._oMessagesModel.getData() || [];
            aMessages.push({ role: "user", content: sMessage });
            this._oMessagesModel.setData(aMessages.slice());
            oInput.setValue("");
            this._scrollToBottom();

            // Show typing indicator
            aMessages.push({ role: "assistant", content: "Thinking..." });
            this._oMessagesModel.setData(aMessages.slice());

            var that = this;
            fetch(this._apiBase + "/api/chat/sendMessage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: sSessionId, message: sMessage })
            })
            .then(function (r) {
                if (!r.ok) throw new Error("Request failed");
                return r.json();
            })
            .then(function (data) {
                var msgs = that._oMessagesModel.getData();
                msgs.pop(); // Remove "Thinking..."
                msgs.push({ role: "assistant", content: data.reply, sources: data.sources });
                that._oMessagesModel.setData(msgs.slice());
                that._scrollToBottom();
            })
            .catch(function (error) {
                var msgs = that._oMessagesModel.getData();
                msgs.pop();
                msgs.push({ role: "assistant", content: "Error: " + error.message });
                that._oMessagesModel.setData(msgs.slice());
            });
        },

        _scrollToBottom: function () {
            var oScroll = this.byId("chatScroll");
            if (oScroll) {
                setTimeout(function () {
                    oScroll.scrollTo(0, 99999);
                }, 100);
            }
        }
    });
});
