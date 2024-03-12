"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const unblocker = require('unblocker');
var unblockerConfig = {
    prefix: '/proxy/',
    requestMiddleware: [],
    responseMiddleware: [],
};
let config = {
    controllers: {
        proxy: function (controller) {
            const url = controller.request.url;
            const sections = url.split('/proxy/');
            controller.request.url = `${sections[0]}/proxy/${sections.pop()}`;
            if (sections.length > 3) {
                controller.response.writeHead(302, {
                    Location: controller.request.url,
                });
                controller.response.end();
                return;
            }
            else {
                const handleRequest = unblocker(unblockerConfig);
                handleRequest(controller.request, controller.response);
            }
        },
    },
};
exports.config = config;
