# TokenStore contracts and test suite

## Contracts
1. TokenStore.sol - key exchange contract with helpers
2. AccountModifiers.sol - a simple contract to hold fee/rebate modifiers
3. TokenTemplate.sol - a sample ERC20 token contract to be used in testing only

Deploy the contract on solidity < 0.4.22 to avoid an issue with certain token contracts.  
[Github issue](https://github.com/ethereum/solidity/issues/4116), [Article](https://medium.com/@chris_77367/explaining-unexpected-reverts-starting-with-solidity-0-4-22-3ada6e82308c)

## Install
```
cd contract
npm install
truffle compile
truffle migrate
```

## Testing
1. Install [truffle](http://truffleframework.com/) 4.x
2. Install [ganache-cli (testrpc)](https://github.com/trufflesuite/ganache-cli) 6.x
3. Launch ganache-cli
4. Launch `truffle test` from command line

## Contact
Email us at tokendotstore@gmail.com with any questions and feedback!
