"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteFactory = exports.Site = exports.VisitorFactory = exports.Visitor = void 0;
const sequelize_1 = require("sequelize");
class Visitor extends sequelize_1.Model {
}
exports.Visitor = Visitor;
function VisitorFactory(sequelize) {
    return sequelize.define('Visitor', {
        ip: sequelize_1.DataTypes.STRING,
        userAgent: sequelize_1.DataTypes.STRING,
    });
}
exports.VisitorFactory = VisitorFactory;
class Site extends sequelize_1.Model {
}
exports.Site = Site;
function SiteFactory(sequelize) {
    return sequelize.define('Site', {
        url: sequelize_1.DataTypes.STRING,
        title: sequelize_1.DataTypes.STRING,
        description: sequelize_1.DataTypes.STRING,
        keywords: sequelize_1.DataTypes.STRING,
    });
}
exports.SiteFactory = SiteFactory;
