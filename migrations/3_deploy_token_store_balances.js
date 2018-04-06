var TokenStoreBalances = artifacts.require("./TokenStoreBalances.sol");

module.exports = function(deployer) {
    deployer.deploy(TokenStoreBalances);
};