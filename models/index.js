"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbFactory = exports.PaintingFactory = exports.painting = exports.SiteFactory = exports.Site = exports.VisitorFactory = exports.Visitor = void 0;
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
        return this.description && this.description.length > 0;
    }
    addVisitor(visitor) {
        return visitor.getSites().then((sites) => {
            if (sites.find((site) => site.id === this.id)) {
                return null;
            }
            visitor.addSite(this);
            return [this, visitor];
        });
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
class painting extends sequelize_1.Model {
}
exports.painting = painting;
function PaintingFactory(sequelize) {
    return painting.init({
        id: {
            type: sequelize_1.DataTypes.INTEGER,
            primaryKey: true,
        },
        title: sequelize_1.DataTypes.STRING,
        yearStart: sequelize_1.DataTypes.INTEGER,
        yearEnd: sequelize_1.DataTypes.INTEGER,
        url: sequelize_1.DataTypes.STRING,
        imageKey: sequelize_1.DataTypes.STRING,
        filename: sequelize_1.DataTypes.STRING,
    }, {
        sequelize,
        tableName: 'paintings',
    });
}
exports.PaintingFactory = PaintingFactory;
function dbFactory(seqOptions) {
    const sequelize = new sequelize_1.Sequelize(seqOptions);
    const Site = SiteFactory(sequelize);
    const Visitor = VisitorFactory(sequelize);
    const Painting = PaintingFactory(sequelize);
    Site.belongsToMany(Visitor, { through: 'SiteVisitor' });
    Visitor.belongsToMany(Site, { through: 'SiteVisitor' });
    return {
        sequelize,
        Site,
        Visitor,
        Painting,
    };
}
exports.dbFactory = dbFactory;
