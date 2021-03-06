/*

  filepreview : A file preview generator for node.js

*/
const winston = require('winston');
winston.exitOnError = false

const cheerio = require('cheerio');

var child_process = require('child_process');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var os = require('os');
var mimedb = require('./db.json');
var download = require('download-file')
const supportedOutputs = ['gif', 'jpg', 'png'];

callbackWithLog = function(message, obj, retVal, callback) {
    if (!retVal) {
        if (obj instanceof Error) {
            winston.log('error', obj);
        } else {
            winston.log('error', message, JSON.stringify(obj));
        }
    } else {
        winston.log('debug', message, JSON.stringify(obj));
    }
    return callback(retVal);
};

setConvertArguments = function(convertArgs, options) {
    if (options.width > 0 && options.height > 0) {
        convertArgs.splice(0, 0, '-resize', options.width + 'x' + options.height);
    }
    if (options.quality) {
        convertArgs.splice(0, 0, '-quality', options.quality);
    }
    if (options.density) {
        convertArgs.splice(0, 0, '-density', options.density);
    }
    if (options.flatten) {
        convertArgs.splice(0, 0, '-flatten');
    }
    if (options.sharpen) {
        convertArgs.splice(0, 0, '-sharpen', options.sharpen);
    }
    if (options.adjoin) {
        convertArgs.splice(0, 0, '-adjoin');
    }
}

module.exports = {

    generate: function(input_original, output, options, callback) {
        // Normalize arguments

        var input = input_original;

        if (typeof options === 'function') {
            callback = options;
            options = {};
        } else {
            options = options || {};
        }

        // Check for supported output format
        var extOutput = path.extname(output).toLowerCase().replace('.', '');
        var extInput = path.extname(input).toLowerCase().replace('.', '');

        if (supportedOutputs.indexOf(extOutput) < 0) {
            return callbackWithLog('Unsuported output extension', extOutput, true, callback);
        }

        var fileType = 'other';
        var convertToHtml = false;

        root:
            for (var index in mimedb) {
                if ('extensions' in mimedb[index]) {
                    for (var indexExt in mimedb[index].extensions) {
                        if (mimedb[index].extensions[indexExt] == extInput) {
                            if (index.split('/')[0] == 'image') {
                                fileType = 'image';
                            } else if (index.split('/')[0] == 'video') {
                                fileType = 'video';
                            } else {
                                if (index.indexOf('spreadsheet') !== -1) {
                                    convertToHtml = true;
                                }
                                fileType = 'other';
                            }

                            break root;
                        }
                    }
                }
            }

        if (extInput == 'pdf') {
            fileType = 'image';
        }

        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
            var url = input.split("/");
            var url_filename = url[url.length - 1];
            var hash = crypto.createHash('sha512');
            hash.update(Math.random().toString());
            hash = hash.digest('hex');
            var temp_input = path.join(os.tmpdir(), hash + url_filename);
            curlArgs = ['--silent', '-L', input, '-o', temp_input];
            child_process.execFileSync("curl", curlArgs);
            input = temp_input;
        }

        fs.lstat(input, function(error, stats) {
            if (error) return callbackWithLog('Error', error, error, callback);
            if (!stats.isFile()) {
                return callbackWithLog('Not a file', stats, true, callback);
            } else {
                if (fileType == 'video') {
                    var ffmpegArgs = ['-y', '-i', input, '-vf', 'thumbnail', '-frames:v', '1', output];
                    if (options.width > 0 && options.height > 0) {
                        ffmpegArgs.splice(4, 1, 'thumbnail,scale=' + options.width + ':' + options.height);
                    }
                    child_process.execFile('ffmpeg', ffmpegArgs, function(error) {
                        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                            fs.unlinkSync(input);
                        }

                        if (error) return callbackWithLog('Error', error, error, callback);
                        return callback();
                    });
                }

                if (fileType == 'image') {
                    var inputPage = input;
                    if (options.page) {
                        inputPage += '[' + options.page + ']';
                    }
                    else if (input.toLowerCase().endsWith('.psd')) {
                        inputPage += '[0]';
                    }
                    var convertArgs = [inputPage, output];
                    setConvertArguments(convertArgs, options);
                    winston.log('debug', 'convert' + convertArgs.join(' '));
                    child_process.execFile('convert', convertArgs, function(error) {
                        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                            fs.unlinkSync(input);
                        }
                        if (error) return callbackWithLog('Error', error, error, callback);;
                        return callback();
                    });
                }

                if (fileType == 'other') {
                    var hash = crypto.createHash('sha512');
                    hash.update(Math.random().toString());
                    hash = hash.digest('hex');
                    var page = 'PageRange=1-99';
                    if (options.page) {
                        page = 'PageRange=' + options.page;
                    }

                    var tempPDF = path.join(os.tmpdir(), hash + '.pdf');
                    var tempHTML = path.join(os.tmpdir(), hash + '.html');

                    if (options.mimeTypeHint === 'simplify3d_stl') {
                        var StlThumbnailer = require('node-stl-thumbnailer');
                        var thumbnailer = new StlThumbnailer({
                                filePath: input,
                                requestThumbnails: [{
                                    width: options.width,
                                    height: options.height
                                }]
                            })
                            .then(function(thumbnails) {
                                thumbnails[0].toBuffer(function(err, buf) {
									if (err) return callbackWithLog('Error', err, err, callback);
                                    fs.writeFile(output.replace(/%[0-9]+d/g, '00'), buf,  function(error) {
                                    if (error) return callbackWithLog('Error', error, error, callback);
                                        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                                            fs.unlink(input);
                                        }
                                        return callback();
									});
                                })
                            })
                    } else {
                        if (!convertToHtml || !(extOutput === 'png' || extOutput === 'jpg')) {
                            winston.log('debug', 'unoconv -e ' + page + ' -o ' + tempPDF + ' ' + input);
                            child_process.execFile('unoconv', ['-e', page, '-o', tempPDF, input], function(error) {
                                if (error) return callbackWithLog('Error', error, error, callback);
								var convertOtherArgs = [tempPDF, output];
								setConvertArguments(convertOtherArgs, options);
								child_process.execFile('convert', convertOtherArgs, function(error) {
                                    if (error) return callbackWithLog('Error', error, error, callback);
									fs.unlink(tempPDF);								
									return callback();
								});
							});
                        } else {
                            child_process.execFile('unoconv', ['-e', page, '-o', tempPDF, input], function(error) {
                                if (error) return callbackWithLog('Error', error, error, callback);
                                var convertOtherArgs = [tempPDF, output];
                                setConvertArguments(convertOtherArgs, options);
                                child_process.execFile('convert', convertOtherArgs, function(error) {
                                    if (error) return callbackWithLog('Error', error, error, callback);
                                    fs.unlink(tempPDF, function(error) {
                                        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                                            fs.unlinkSync(input);
                                        }
                                        if (error) return callbackWithLog('Error', error, error, callback);
                                        return callback();
                                    });
                                });
                            });
                        }
                    }
                }
            }
        });
    },

    generateSync: function(input_original, output, options) {

        options = options || {};

        var input = input_original;

        // Check for supported output format
        var extOutput = path.extname(output).toLowerCase().replace('.', '');
        var extInput = path.extname(input).toLowerCase().replace('.', '');

        if (supportedOutputs.indexOf(extOutput) < 0) {
            winston.log('debug', 'Unsupported output extension', JSON.stringify(extOutput));
            return false;
        }

        var fileType = 'other';
        var convertToHtml = false;

        root:
            for (var index in mimedb) {
                if ('extensions' in mimedb[index]) {
                    for (var indexExt in mimedb[index].extensions) {
                        if (mimedb[index].extensions[indexExt] == extInput) {
                            if (index.split('/')[0] == 'image') {
                                fileType = 'image';
                            } else if (index.split('/')[0] == 'video') {
                                fileType = 'video';
                            } else {
                                if (index.indexOf('spreadsheet') !== -1) {
                                    convertToHtml = true;
                                }
                                fileType = 'other';
                            }

                            break root;
                        }
                    }
                }
            }

        if (extInput == 'pdf') {
            fileType = 'image';
        }

        if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
            var url = input.split("/");
            var url_filename = url[url.length - 1];
            var hash = crypto.createHash('sha512');
            hash.update(Math.random().toString());
            hash = hash.digest('hex');
            var temp_input = path.join(os.tmpdir(), hash + url_filename);
            curlArgs = ['--silent', '-L', input, '-o', temp_input];
            child_process.execFileSync("curl", curlArgs);
            input = temp_input;
        }

        try {
            stats = fs.lstatSync(input);

            if (!stats.isFile()) {
                return false;
            }
        } catch (e) {
            winston.log('error', e);
            return false;
        }

        if (fileType == 'video') {
            try {
                var ffmpegArgs = ['-y', '-i', input, '-vf', 'thumbnail', '-frames:v', '1', output];
                if (options.width > 0 && options.height > 0) {
                    ffmpegArgs.splice(4, 1, 'thumbnail,scale=' + options.width + ':' + options.height)
                }
                child_process.execFileSync('ffmpeg', ffmpegArgs);
                if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                    fs.unlinkSync(input);
                }
                return true;
            } catch (e) {
                winston.log('error', e);
                return false;
            }
        }

        if (fileType == 'image') {
            try {
                var inputPage = input;
                if (options.page) {
                    inputPage += '[' + options.page + ']';
                }
                else if (input.toLowerCase().endsWith('.psd')) {
                    inputPage += '[0]';
                }
                var convertArgs = [inputPage, output];
                setConvertArguments(convertArgs, options);
                winston.log('debug', 'convert' + convertArgs.join(' '));
                child_process.execFileSync('convert', convertArgs);
                if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                    fs.unlinkSync(input);
                }
                return true;
            } catch (e) {
                winston.log('error', e);
                return false;
            }
        }

        if (fileType == 'other') {
            try {
                var hash = crypto.createHash('sha512');
                hash.update(Math.random().toString());
                hash = hash.digest('hex');
                var page = 'PageRange=1-99';
                if (options.page) {
                    page = 'PageRange=' + options.page;
                }

                var tempPDF = path.join(os.tmpdir(), hash + '.pdf');
                var tempHTML = path.join(os.tmpdir(), hash + '.html');

                if (options.mimeTypeHint === 'simplify3d_stl') {
                    var StlThumbnailer = require('node-stl-thumbnailer');
                    var thumbnailer = new StlThumbnailer({
                            filePath: input,
                            requestThumbnails: [{
                                width: options.width,
                                height: options.height
                            }]
                        })
                        .then(function(thumbnails) {
                            thumbnails[0].toBuffer(function(err, buf) {
                                fs.writeFileSync(output.replace(/%[0-9]+d/g, '00'), buf);
                            })
                        })
                } else {
                    if (!convertToHtml || !(extOutput === 'png' || extOutput === 'jpg')) {
                        winston.log('debug', 'unoconv -e ' + page + ' -o ' + tempPDF + ' ' + input);
                        child_process.execFileSync('unoconv', ['-e', page, '-o', tempPDF, input]);
                        var convertOtherArgs = [tempPDF, output];
                        setConvertArguments(convertOtherArgs, options);
                        child_process.execFileSync('convert', convertOtherArgs);
                        fs.unlinkSync(tempPDF);
                    } else {
                        winston.log('debug', 'unoconv -f html -e ' + page + ' -o ' + tempHTML + ' ' + input);
                        child_process.execFileSync('unoconv', ['-f', 'html', '-e', page, '-o', tempHTML, input]);
                        var $ = cheerio.load(fs.readFileSync(tempHTML));
                        var headHtml = $.html($('head')[0]);
                        var pageCounter = 0;
                        var tables = $('a[name^="table"]').next();
                        for (var i = 0; i < tables.length; i++) {
                            var pageNumber = ('00' + pageCounter).slice(-2);
                            var tempHTMLPage = tempHTML + '_' + pageNumber + '.html';
                            fs.writeFileSync(tempHTMLPage, '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">\n');
                            fs.appendFileSync(tempHTMLPage, '<html>\n' + headHtml + '\n<body>');
                            fs.appendFileSync(tempHTMLPage, $.html($(tables[i])));
                            fs.appendFileSync(tempHTMLPage, '</body>\n</html>');
                            winston.log('debug', 'xvfb-run -a wkhtmltoimage -f ' + extOutput + ' ' + tempHTMLPage + ' ' + output.replace(/%[0-9]+d/g, pageNumber));
                            child_process.execFileSync('xvfb-run', ['-a', 'wkhtmltoimage', '-f', extOutput, tempHTMLPage, output.replace(/%[0-9]+d/g, pageNumber)]);
                            fs.unlinkSync(tempHTMLPage);
                            ++pageCounter;
                        }
                        fs.unlinkSync(tempHTML);
                    }
                }

                if (input_original.indexOf("http://") == 0 || input_original.indexOf("https://") == 0) {
                    fs.unlinkSync(input);
                }
                return true;
            } catch (e) {
                winston.log('error', e);
                return false;
            }
        }
    }
};