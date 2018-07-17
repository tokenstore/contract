var AccountModifiers = artifacts.require("./AccountModifiers.sol");
var TokenTemplate = artifacts.require("./InstantTradeContracts/EIP20.sol");
var TokenStore = artifacts.require("./TokenStore.sol");
var InstantTrade = artifacts.require("./InstantTrade.sol");

module.exports = function(deployer) {
  deployer.deploy(AccountModifiers);
  deployer.deploy(TokenTemplate, web3.toBigNumber(1000000000000000000000000), "Token", 18, "Token");
  deployer.deploy(TokenStore, web3.toBigNumber(3000000000000000), "0x0000000000000000000000000000000000000000");
  deployer.deploy(InstantTrade);
};