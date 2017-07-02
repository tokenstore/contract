pragma solidity ^0.4.11;

contract Ownable {
  address public owner;

  function Ownable() {
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner);
    _;
  }

  function transferOwnership(address newOwner) onlyOwner {
    if (newOwner != address(0)) {
      owner = newOwner;
    }
  }
}

contract AccountModifiers is Ownable {

  mapping (address => uint) public takerFeeDiscounts;   // in % of taker fee (Eg: 100 for 100%)
  mapping (address => uint) public rebatePercentages;  // in % of taker fee charged

  function setModifiers(address _user, uint _takeFeeDiscount, uint _rebatePercentage) onlyOwner {
    takerFeeDiscounts[_user] = _takeFeeDiscount;
    rebatePercentages[_user] = _rebatePercentage;
  }

  function modifiers(address _maker, address _taker) constant returns(uint takeFeeDiscount, uint rebatePercentage) {
    return (takerFeeDiscounts[_taker], rebatePercentages[_maker]);
  }
}
