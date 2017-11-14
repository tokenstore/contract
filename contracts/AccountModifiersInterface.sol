pragma solidity ^0.4.13;

// Interface for trading discounts and rebates for specific accounts

contract AccountModifiersInterface {
  function accountModifiers(address _user) constant returns(uint takeFeeDiscount, uint rebatePercentage);
  function tradeModifiers(address _maker, address _taker) constant returns(uint takeFeeDiscount, uint rebatePercentage);
}