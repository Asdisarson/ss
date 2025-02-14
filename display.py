#!/usr/bin/env python3

import time
import math
import board
import digitalio
import psutil
import requests
import redis
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import adafruit_rgb_display.ili9341 as ili9341

# Configuration for CS and DC pins
cs_pin = digitalio.DigitalInOut(board.CE0)
dc_pin = digitalio.DigitalInOut(board.D25)
reset_pin = digitalio.DigitalInOut(board.D24)

# Config for display baudrate (default max is 24mhz)
BAUDRATE = 24000000

# Setup SPI bus using hardware SPI
spi = board.SPI()

# Create the display
disp = ili9341.ILI9341(
    spi,
    rotation=90,
    cs=cs_pin,
    dc=dc_pin,
    rst=reset_pin,
    baudrate=BAUDRATE,
)

# Create blank image for drawing
width = disp.width
height = disp.height
image = Image.new("RGB", (width, height))
draw = ImageDraw.Draw(image)

# Load fonts with different sizes for variety
try:
    font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    font_mono = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 16)
except OSError:
    font_title = ImageFont.load_default()
    font = ImageFont.load_default()
    font_small = ImageFont.load_default()
    font_mono = ImageFont.load_default()

# Modern color palette
BACKGROUND = (10, 12, 16)
ACCENT1 = (41, 128, 185)  # Blue
ACCENT2 = (46, 204, 113)  # Green
ACCENT3 = (231, 76, 60)   # Red
ACCENT4 = (241, 196, 15)  # Yellow
TEXT_PRIMARY = (236, 240, 241)
TEXT_SECONDARY = (189, 195, 199)

# Animation variables
animation_frame = 0
loading_angle = 0

def draw_loading_circle(x, y, size, progress, color):
    """Draw a circular progress indicator"""
    global loading_angle
    loading_angle = (loading_angle + 6) % 360
    start_angle = loading_angle
    end_angle = start_angle + (360 * progress)
    
    # Draw background circle
    draw.arc((x - size, y - size, x + size, y + size), 0, 360, 
             fill=(color[0]//3, color[1]//3, color[2]//3), width=3)
    
    # Draw progress arc
    draw.arc((x - size, y - size, x + size, y + size), start_angle, end_angle, 
             fill=color, width=3)

def draw_progress_bar(x, y, width, height, progress, color):
    """Draw a stylish progress bar"""
    # Background
    draw.rectangle((x, y, x + width, y + height), fill=(color[0]//3, color[1]//3, color[2]//3))
    # Progress
    bar_width = int(width * progress)
    if bar_width > 0:
        draw.rectangle((x, y, x + bar_width, y + height), fill=color)

def get_api_status():
    try:
        response = requests.get('http://localhost:3000/api/products', timeout=5)
        return response.status_code == 200
    except:
        return False

def get_redis_status():
    try:
        r = redis.Redis(host='localhost', port=6379, db=0)
        return r.ping()
    except:
        return False

def get_system_info():
    cpu = psutil.cpu_percent()
    memory = psutil.virtual_memory().percent
    disk = psutil.disk_usage('/').percent
    return cpu, memory, disk

def draw_status_box(x, y, title, status, color):
    """Draw a modern status box with animation"""
    box_width = 140
    box_height = 50
    radius = 10
    
    # Draw rounded rectangle
    draw.rounded_rectangle((x, y, x + box_width, y + box_height), radius, fill=(30, 33, 41))
    
    # Draw title
    draw.text((x + 10, y + 8), title, font=font_small, fill=TEXT_SECONDARY)
    
    # Draw status with icon
    icon = "●" if status else "○"
    status_text = "ONLINE" if status else "OFFLINE"
    draw.text((x + 10, y + 28), icon, font=font, fill=color if status else ACCENT3)
    draw.text((x + 30, y + 28), status_text, font=font_small, fill=color if status else ACCENT3)

def update_display():
    global animation_frame
    animation_frame = (animation_frame + 1) % 60

    # Clear the image with a gradient background
    for y in range(height):
        color = (
            10 + int(y/height * 5),
            12 + int(y/height * 5),
            16 + int(y/height * 5)
        )
        draw.line((0, y, width, y), fill=color)

    # Get statuses and metrics
    api_status = get_api_status()
    redis_status = get_redis_status()
    cpu, memory, disk = get_system_info()

    # Draw decorative header
    draw.rectangle((0, 0, width, 50), fill=(15, 18, 23))
    draw.text((10, 10), "Product Search API", font=font_title, fill=ACCENT1)
    
    # Draw status boxes
    draw_status_box(10, 60, "API Status", api_status, ACCENT2)
    draw_status_box(160, 60, "Redis", redis_status, ACCENT2)

    # System metrics section
    y = 130
    draw.text((10, y), "SYSTEM METRICS", font=font_small, fill=TEXT_SECONDARY)
    y += 25

    # CPU Usage with animated circle
    draw_loading_circle(35, y + 15, 15, cpu/100, ACCENT1)
    draw.text((60, y), "CPU", font=font_small, fill=TEXT_PRIMARY)
    draw_progress_bar(60, y + 20, 150, 6, cpu/100, ACCENT1)
    draw.text((215, y), f"{cpu}%", font=font_mono, fill=TEXT_PRIMARY)
    
    # Memory Usage
    y += 45
    draw_loading_circle(35, y + 15, 15, memory/100, ACCENT4)
    draw.text((60, y), "RAM", font=font_small, fill=TEXT_PRIMARY)
    draw_progress_bar(60, y + 20, 150, 6, memory/100, ACCENT4)
    draw.text((215, y), f"{memory}%", font=font_mono, fill=TEXT_PRIMARY)

    # Disk Usage
    y += 45
    draw_loading_circle(35, y + 15, 15, disk/100, ACCENT2)
    draw.text((60, y), "DISK", font=font_small, fill=TEXT_PRIMARY)
    draw_progress_bar(60, y + 20, 150, 6, disk/100, ACCENT2)
    draw.text((215, y), f"{disk}%", font=font_mono, fill=TEXT_PRIMARY)

    # Draw time with pulsing effect
    current_time = time.strftime("%H:%M:%S")
    pulse = abs(math.sin(animation_frame * 0.1)) * 0.3 + 0.7
    time_color = tuple(int(c * pulse) for c in TEXT_PRIMARY)
    draw.text((width//2 - 50, height - 30), current_time, 
              font=font_mono, fill=time_color)

    # Display the image
    disp.image(image)

def main():
    print("Starting API status display...")
    while True:
        try:
            update_display()
            time.sleep(0.05)  # Shorter sleep for smoother animations
        except Exception as e:
            print(f"Error updating display: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main() 