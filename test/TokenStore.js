var TokenStore = artifacts.require("./TokenStore.sol");
var AccountModifiers = artifacts.require("./AccountModifiers.sol");
var Token = artifacts.require("./TokenTemplate.sol");

var sha256 = require('js-sha256').sha256;
var util = require('./util.js');
var async = require('async');
var config = require('../truffle.js');

contract('TokenStore', function(accounts) {

  var unlockedAccounts = 5;
  var accs = accounts.slice(0, unlockedAccounts - 1); // Last account is used for fees only
  const gasPrice = config.networks.development.gasPrice;
  const feeAccount = unlockedAccounts - 1;
  const fee = 3000000000000000;
  const userToken = 2000000;
  const depositedEther = 100000;
  const depositedToken = 1000000;
  const defaultExpirationInBlocks = 100;
  const failedTransactionError = "Error: VM Exception while processing transaction: invalid opcode";

  ///////////////////////////////////////////////////////////////////////////////////
  // Helper functions
  ///////////////////////////////////////////////////////////////////////////////////

  // Creates a test token and distributes among all test accounts
  function createAndDistributeToken(symbol, callback) {
    var token;
    return Token.new(userToken*accounts.length, "TestToken", 3, symbol, {from: accounts[feeAccount]}).then(function(instance) {
      token = instance;
    }).then(function(result) {
      return new Promise((resolve, reject) => {
        async.eachSeries(accounts,
          (account, callbackEach) => {
            token.transfer(account, userToken, {from: accounts[feeAccount]}).then(function(result) {
              callbackEach(null);
            });
          },
          () => {
            resolve(token);
          });
      });
    });
  }

  // Deposits a portion of the token to the exchange from all test accounts
  function depositTokenByAllAccounts(dec, token) {
    return new Promise((resolve, reject) => {
      async.eachSeries(accounts,
        (account, callbackEach) => {
          token.approve(dec.address, depositedToken, {from: account}).then(function(result) {
            dec.depositToken(token.address, depositedToken, {from: account}).then(function(result) {
              callbackEach(null);
            });
          },
          () => {
            resolve();
          });
        });
    });
  }

  // Deposit ether to the exchange from all test accounts
  function depositEtherByAllAccounts(dec) {
    return new Promise((resolve, reject) => {
      async.eachSeries(accs,
        (account, callbackEach) => {
          dec.deposit({from: account, value: depositedEther}).then(function(result) {
            callbackEach(null);
          });
        },
        () => {
          resolve();
        });
    });
  }

  // Creates a bunch of tokens, distributes them, deposits ether and tokens
  // by all the participants to the exchange so we can test different operations
  function initialConfiguration() {
    var token1, token2;
    var dec;
    return TokenStore.new(fee, 0, {from: accounts[feeAccount]}).then(function(instance) {
      dec = instance;
      return createAndDistributeToken("TT1");
    }).then(function(instance) {
      token1 = instance;
      return createAndDistributeToken("TT2");
    }).then(function(instance) {
      token2 = instance;
      return depositTokenByAllAccounts(dec, token1);
    }).then(function(result) {
      return depositTokenByAllAccounts(dec, token2);
    }).then(function(result) {
      return depositEtherByAllAccounts(dec);
    }).then(function(result) {
      return {dec: dec, token1: token1, token2: token2};
    });
  }
  
  function executePromises(checks) {
    return new Promise((resolve, reject) => {
      async.eachSeries(checks,
        (check, callbackEach) => {
          check().then(function(result) {
            callbackEach(null);
          });
        },
        () => {
          resolve();
        });
    });
  }
  
  function getBlockNumber() {
    return new Promise((resolve, reject) => {
      web3.eth.getBlockNumber((error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }
  
  function getAccountBalance(account) {
    return new Promise((resolve, reject) => {
      web3.eth.getBalance(account, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }
  
  function signOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce) {
    const condensed = util.pack([
      dec.address,
      tokenGet,
      amountGet,
      tokenGive,
      amountGive,
      expires,
      nonce,
    ], [160, 160, 256, 160, 256, 256, 256]);
    const hash = sha256(new Buffer(condensed, 'hex'));
    return util.promisify(util.sign, [web3, creatorAddress, hash, ''])  
  }
  
  function executeOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, amountGiven, from, expire, nonce) {
    var realExpire;
    var realNonce = nonce || Math.floor(Math.random());
    return getBlockNumber().then(function(result) {
      realExpire = expire || result+defaultExpirationInBlocks;
      return signOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, realExpire, realNonce);
    }).then(function(result) {
      return dec.trade(tokenGet, amountGet, tokenGive, amountGive, realExpire,
          realNonce, creatorAddress, result.v, result.r, result.s, amountGiven, {from: from});
    });
  }
  
  ///////////////////////////////////////////////////////////////////////////////////
  // Tests functions
  ///////////////////////////////////////////////////////////////////////////////////
  
  it("Depositing", function() {
    
    return initialConfiguration().then(function(result) {
      var dec = result.dec;
      var token1 = result.token1;
      var token2 = result.token2;
      
      var checks = [
        function() { return dec.balanceOf.call(token1.address, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #1 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #2 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(0, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositedEther, "Ether deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #1 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #2 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedEther, "Ether deposit for acc #0 was not successful");
        }) },
        function() { return dec.fee.call().then(function(result) {
          assert.equal(result.toNumber().valueOf(), fee, "The fee is incorrect");
        }) }
      ];
      
      return executePromises(checks);
    });
  });
  
  it("Withdrawals", function() {

    var dec, token1;
    var userEther;
    var gasSpent = 0; // We will need it to get precise remaining ether amount
    
    return initialConfiguration().then(function(result) {
      dec = result.dec;
      token1 = result.token1;
      

      var checks = [
        function() { return getAccountBalance(accounts[0]).then(function(result) {
          userEther = result.toNumber();
        }) },
        function() { return token1.balanceOf.call(accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), userToken - depositedToken, "Token #1 deposit for acc #0 is not correct");
        }) },
      ];
      
      return executePromises(checks);
      
    }).then(function(result) {

      var operations = [
        function() { return dec.withdraw(depositedEther, {from: accounts[0]}).then(function(result) { gasSpent += result.receipt.gasUsed; }); },
        function() { return dec.withdrawToken(token1.address, depositedToken, {from: accounts[0]}).then(function(result) { gasSpent += result.receipt.gasUsed; }); },
      ];
      
      return executePromises(operations);
      
    }).then(function(result) {

      var checks = [
        function() { return getAccountBalance(accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), userEther + depositedEther - gasSpent * gasPrice, "Ether balance was not increased");
        }) },
        function() { return token1.balanceOf.call(accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), userToken, "Token #1 balance is not increased");
        }) },
        function() { return dec.balanceOf.call(0, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Exchange still thinks it holds some ether for the user");
        }) },
        function() { return dec.balanceOf.call(token1.address, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Exchange still thinks it holds some tokens for the user");
        }) },
      ];
      
      return executePromises(checks);
    });
  });
  
  // Note: this tests only Eth to Token but since we treat eth internally
  // as a token with 0 address, direction is not important. It can also be
  // Token to Token for that matter.
  it("Successful trade", function() {
  
    var dec;
    
    var tokenGet = 0;       // Eth as a token type
    var tokenGive;          // Token address for wanted token
    var amountGet = 20000;   // Eth wanted
    var amountGive = 100000; // Token given in return
    var amountGiven = 10000; // Ether given by a counter-party
    
    return initialConfiguration().then(function(result) {

      dec = result.dec;
      tokenGive = result.token1.address;

      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven, accounts[1]);

    }).then(function(result) {

      var checks = [
        function() { return dec.balanceOf.call(tokenGive, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 950000, "Token sale for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGive, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 1050000, "Token purchase for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 110000, "Eth purchase for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 89970, "Eth sale for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[feeAccount]).then(function(result) {
          assert.equal(result.toNumber(), 30, "Eth fee is incorrect");
        }) }
      ];

      return executePromises(checks);
    });
  });
  
  it("Account modifiers", function() {
  
    var dec;
    var accountModifiers;
    
    var tokenGet = 0;       // Eth as a token type
    var tokenGive;          // Token address for wanted token
    var amountGet = 20000;   // Eth wanted
    var amountGive = 100000; // Token given in return
    var amountGiven = 10000; // Ether given by a counter-party
    
    return initialConfiguration().then(function(result) {

      dec = result.dec;
      tokenGive = result.token1.address;
      
      return AccountModifiers.new({from: accounts[feeAccount]});
    }).then(function(result) {
    
    	accountModifiers = result;
    	return accountModifiers.setModifiers(accounts[0], 20, 30, {from: accounts[feeAccount]});
    	
    }).then(function(result) {
    	
    	return accountModifiers.setModifiers(accounts[1], 40, 50, {from: accounts[feeAccount]});
    	
    }).then(function(result) {
    
      return dec.changeAccountModifiers(accountModifiers.address, {from: accounts[feeAccount]});
    
    }).then(function(result) {

      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven, accounts[1]);

    }).then(function(result) {

      // Based on the numbers above taker fee discount (account #1) is 40%
      // maker rebate (account #0) is 30%. For default fee of 0.3% (30 wei)
      // that would translate in (100% - 40%) * 30 wei = 18 wei taker fee and
      // 30% * 18 wei = 5.4 (~5) wei as maker rebate
      var checks = [
        function() { return dec.balanceOf.call(tokenGive, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 950000, "Token sale for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGive, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 1050000, "Token purchase for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 110005, "Eth purchase for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 89982 /*100000-18*/, "Eth sale for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[feeAccount]).then(function(result) {
          assert.equal(result.toNumber(), 13 /*18-5*/, "Eth fee is incorrect");
        }) }
      ];

      return executePromises(checks);
    });
  });
  
  it("Failed trades", function() {
  
    var dec;

    var tokenGet = 0;       // Eth as a token type
    var tokenGive;          // Other token type
    var amountGet = 2000;   // Eth wanted
    var amountGive = 10000; // Token given in return
    
    var fixedExpire = 1000000000; // High enough block number
    var fixedNonse = 0;

    return initialConfiguration().then(function(result) {
    
      dec = result.dec;
      tokenGive = result.token1.address;

      // Tries to buy more than total order request
      var amountGiven1 = 3000;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven1, accounts[1]);
    }).then(function(result) {
      assert(false, "Transaction passed, it should not had");
    }, function(error) {
      assert.equal(error, failedTransactionError, "Incorrect error");

      // Tries to offer more than the buyer has (using an account that didn't deposit)
      var amountGiven2 = 1000;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven2, accounts[feeAccount]);
    }).then(function(result) {
      assert(false, "Transaction passed, it should not had");
    }, function(error) {
      assert.equal(error, failedTransactionError, "Incorrect error");

      // Oversubscribed order (multiple trades with overflowing total)
      var amountGiven31 = 1500;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven31, accounts[1], fixedExpire, fixedNonse);
    }).then(function(result) {
      var amountGiven32 = 700;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven32, accounts[1], fixedExpire, fixedNonse);
    }, function(error) {
      assert(false, "First transaction should pass, we're going to fail on a second");
    }).then(function(result) {
      assert(false, "Second transaction passed, it should not had");
    }, function(error) {
      assert.equal(error, failedTransactionError, "Incorrect error");
    });
  });
  
  // Here we create a chain of 3 exchanges and try to migrate funds from 1st to 3rd
  it("Funds migration", function() {
    var dec, tempIntermediaryDec, newDec, token1, token2;

    return initialConfiguration().then(function(result) {
    
      dec = result.dec;
      token1 = result.token1;
      token2 = result.token2;
      return TokenStore.new(fee, dec.address, {from: accounts[feeAccount]});
      
    }).then(function(result) {
    
      tempIntermediaryDec = result;
      // Set a proper successor for the old exchange - temporary intermediary exchange
      return dec.deprecate(true, tempIntermediaryDec.address, {from: accounts[feeAccount]});
      
    }).then(function(result) {
    
      return TokenStore.new(fee, tempIntermediaryDec.address, {from: accounts[feeAccount]});
      
    }).then(function(result) {
    
      newDec = result;
      // Set a proper successor for the temporary intermediary
      return tempIntermediaryDec.deprecate(true, newDec.address, {from: accounts[feeAccount]});
      
    }).then(function(result) {
    
      // Check if the new exchange has zero balance and old exchange has it all
      var checks = [
        function() { return newDec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited token #1");
        }) },
        function() { return newDec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited token #2");
        }) },
        function() { return newDec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited eth");
        }) },
        function() { return dec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Incorrect value of deposited token #1");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Incorrect value of deposited token #2");
        }) },
        function() { return dec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedEther, "Incorrect value of deposited eth");
        }) },
        function() { return token1.balanceOf.call(dec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken * unlockedAccounts, "Token #1 stores incorrect value for dec");
        }) },
        function() { return token2.balanceOf.call(dec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken * unlockedAccounts, "Token #2 stores incorrect value for dec");
        }) },
        function() { return token1.balanceOf.call(newDec.address).then(function(result) {
          assert.equal(result.toNumber(), 0, "Token #1 stores incorrect value for newDec");
        }) },
        function() { return token2.balanceOf.call(newDec.address).then(function(result) {
          assert.equal(result.toNumber(), 0, "Token #2 stores incorrect value for newDec");
        }) }
      ];

      return executePromises(checks);
      
    }).then(function(result) {
      return dec.migrateFunds([token1.address, token2.address], {from: accounts[1]});
    }).then(function(result) {

      // Check in reverse now - new exchange should have this user tokens/ether now
      var checks = [
        function() { return dec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited token #1");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited token #2");
        }) },
        function() { return dec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 0, "Incorrect value of deposited eth");
        }) },
        function() { return newDec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Incorrect value of deposited token #1");
        }) },
        function() { return newDec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Incorrect value of deposited token #2");
        }) },
        function() { return newDec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositedEther, "Incorrect value of deposited eth");
        }) },
        function() { return token1.balanceOf.call(dec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken * (unlockedAccounts - 1), "Token #1 stores incorrect value for dec");
        }) },
        function() { return token2.balanceOf.call(dec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken * (unlockedAccounts - 1), "Token #2 stores incorrect value for dec");
        }) },
        function() { return token1.balanceOf.call(newDec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #1 stores incorrect value for newDec");
        }) },
        function() { return token2.balanceOf.call(newDec.address).then(function(result) {
          assert.equal(result.toNumber(), depositedToken, "Token #2 stores incorrect value for newDec");
        }) },
        
        // Bonus: check that normal users cannot access the migration helpers
        // so they cannot send to somebody else by mistake
        function() {
          return newDec.depositForUser(accounts[0], {from: accounts[2], value: 1}).then(function(result) {
            assert(false, "User was able to deposit to a different user address (shouldn't have been)");
          }, function(error) {
            assert.equal(error, failedTransactionError, "Incorrect error");
          });
        },
        function() {
          return token1.approve(newDec.address, 100, {from: accounts[2]}).then(function(result) {
            return newDec.depositTokenForUser(token1.address, 100, accounts[0], {from: accounts[2]}).then(function(result) {
              assert(false, "User was able to deposit to a different user address (shouldn't have been)");
            }, function(error) {
              assert.equal(error, failedTransactionError, "Incorrect error");
            });
          });
        },
      ];

      return executePromises(checks);      
    } );
  });
});
