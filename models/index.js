"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbFactory = exports.SiteFactory = exports.Site = exports.VisitorFactory = exports.Visitor = void 0;
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
    isDescribed() {
        console.log('doing the is described thing');
        return this.description && this.description.length > 0;
    }
    static sayHello() {
        console.log('Saying helllooo');
        return 'HELLO!';
    }
}
exports.Site = Site;
function SiteFactory(sequelize) {
    return Site.init({
        url: sequelize_1.DataTypes.STRING,
        title: sequelize_1.DataTypes.STRING,
        description: sequelize_1.DataTypes.STRING,
        keywords: sequelize_1.DataTypes.STRING,
    }, {
        sequelize,
        tableName: 'sites',
    });
}
exports.SiteFactory = SiteFactory;
function dbFactory(seqOptions) {
    if (!seqOptions.dialect) {
        seqOptions.dialect = 'sqlite';
        seqOptions.storage = seqOptions.storage || `${__dirname}/database.sqlite`;
    }
    seqOptions.logging = seqOptions.logging || false;
    seqOptions.dialectOptions = seqOptions.dialectOptions || {
        decimalNumbers: true,
    };
    seqOptions.define = seqOptions.define || { underscored: true };
    const sequelize = new sequelize_1.Sequelize(seqOptions);
    const Site = SiteFactory(sequelize);
    const Visitor = VisitorFactory(sequelize);
    Site.belongsToMany(Visitor, { through: 'SiteVisitor' });
    Visitor.belongsToMany(Site, { through: 'SiteVisitor' });
    return {
        sequelize,
        Site,
        Visitor,
    };
}
exports.dbFactory = dbFactory;
