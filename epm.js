var path = require("path");
var fs = require("fs");
var filter = require("async/filter");
var detectSeries = require("async/detectSeries");
var eachSeries = require("async/eachSeries")
var EthPM = require("ethpm");
var contract = require("truffle-contract");
var Blockchain = require("truffle-blockchain-utils");
var FSSource = require("./fs.js");

function EPM(working_directory, contracts_build_directory) {
  this.working_directory = working_directory;
  this.contracts_build_directory = contracts_build_directory;
};

EPM.prototype.require = function(import_path, search_path) {
  if (import_path.indexOf(".") == 0 || import_path.indexOf("/") == 0) {
    return null;
  }

  // Look to see if we've compiled our own version first.
  var contract_filename = path.basename(import_path);
  var contract_name = path.basename(import_path, ".sol");

  var fs_source = new FSSource(this.working_directory, search_path || this.contracts_build_directory)

  var result = fs_source.require("./" + contract_filename);

  if (result != null) return result;

  // We haven't compiled our own version. Assemble from data in the lockfile.
  var separator = import_path.indexOf("/")
  var package_name = import_path.substring(0, separator);
  console.log("package_name", package_name);

  var install_directory = path.join(this.working_directory, "installed_contracts");
  var lockfile = path.join(install_directory, package_name, "lock.json");

  lockfile = fs.readFileSync(lockfile, "utf8");
  lockfile = JSON.parse(lockfile);

  var json = {
    contract_name: contract_name,
    networks: {}
  };

  // TODO: contracts that reference other types
  // TODO: contract types that specify a hash as their key
  // TODO: imported name doesn't match type but matches deployment name
  var contract_types = lockfile.contract_types || {};
  var type = contract_types[contract_name];

  // No contract name of the type asked.
  if (!type) return null;

  json.abi = type.abi;
  json.unlinked_binary = type.bytecode;

  // Go through deployments and save all of them
  Object.keys(lockfile.deployments || {}).forEach(function(blockchain) {
    var deployments = lockfile.deployments[blockchain];

    Object.keys(deployments).forEach(function(name) {
      var deployment = deployments[name];
      if (deployment.contract_type == contract_name) {
        json.networks[blockchain] = {
          events: {},
          links: {},
          address: deployment.address
        };
      }
    });
  });

  return json;
}

EPM.prototype.resolve = function(import_path, callback) {
  var separator = import_path.indexOf("/")
  var package_name = import_path.substring(0, separator);
  var internal_path = import_path.substring(separator + 1);
  var install_directory = path.join(this.working_directory, "installed_contracts");

  var file_contents = undefined;

  detectSeries([
    path.join(install_directory, import_path),
    path.join(install_directory, package_name, "contracts", internal_path)
  ], function(file_path, finished) {
    fs.readFile(file_path, {encoding: "utf8"}, function(err, body) {
      if (err) return finished(null, false);

      file_contents = body;
      finished(null, true);
    });
  }, function(err, existing_path) {
    // If there's an error, that means we can't read the source even if
    // it exists. Treat it as if it doesn't by ignoring any errors.
    // Perhaps we can do something better here in the future.
    return callback(null, file_contents);
  });
},

// We're resolving package paths to other package paths, not absolute paths.
// This will ensure the source fetcher conintues to use the correct sources for packages.
// i.e., if some_module/contracts/MyContract.sol imported "./AnotherContract.sol",
// we're going to resolve it to some_module/contracts/AnotherContract.sol, ensuring
// that when this path is evaluated this source is used again.
EPM.prototype.resolve_dependency_path = function(import_path, dependency_path) {
  var dirname = path.dirname(import_path);
  return path.join(dirname, dependency_path);
};

module.exports = EPM;
