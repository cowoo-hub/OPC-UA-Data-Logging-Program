# Masterway – AI-Powered IO-Link Monitoring & Diagnostics Platform
An industrial-grade monitoring system that transforms IO-Link data into real-time insights, diagnostics, and predictive intelligence.

## Architecture

IO-Link Sensors  
    ↓  
IO-Link Master (ICE2 / ICE11)  
    ↓  
Modbus TCP  
    ↓  
FastAPI Backend (Data Processing & API)  
    ↓  
React Frontend (Monitoring UI & AI Diagnostics)

Masterway uses Modbus TCP as the primary communication protocol to directly interface with IO-Link Masters.
The backend continuously reads Process Data (PDI) from each port and processes it into structured data for visualization and AI-based diagnostics.

### Why Modbus TCP?

- Direct communication with IO-Link Master (no middleware required)
- Lightweight and reliable industrial protocol
- Easy integration with PLC and HMI systems
- Suitable for real-time monitoring environments

## System Concept

Masterway is not designed to replace PLC systems.

Instead, it provides a PC-based monitoring and diagnostics layer that allows engineers to observe and analyze IO-Link data with PLC-level responsiveness from a control-room environment.

It enables:

- Fast and intuitive monitoring similar to PLC/HMI systems
- Centralized visibility across multiple IO-Link ports
- Enhanced diagnostics beyond traditional PLC capabilities
