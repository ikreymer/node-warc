
let fs = null;
let untildify = null;
let hasFS = null;

try {
    untildify = require('untildify')
    fs = require('fs-extra')
    hasFS = true;
} catch (e) {
    hasFS = false;
}

function getStream(wp, useUntildify) {
    if (hasFS) {
        if (useUntildify) {
            wp = untildify(wp);
        }

        return fs.createReadStream(wp);
    }

    return wp;
}

//module.exports = getStream;
module.exports.getStream = getStream;
module.exports.fs = fs;
module.exports.untildify = untildify;

